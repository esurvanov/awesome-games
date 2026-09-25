#!/usr/bin/env python3
"""Builds the interface graphics from the downloaded 0 A.D. materials (assets/0ad_raw, see tools/fetch_0ad.py)
into assets/ui/ (stored in git): only the pictures in use, DDS -> PNG, portraits reduced to 128x128.
Fonts (Linux Biolinum, GNU FreeSans) - into assets/fonts/; PT Serif and Cormorant SC (OFL, Google Fonts) are stored
in assets/fonts/ in the repository and are not touched here. Icons by the DE dictionary - tools/ui_icon_art.py (called at the end);
"picture" buildings, orders and portraits in the DE frame - tools/build_portraits.py (separately, a 3D render is needed).

0 A.D. materials (c) Wildfire Games, CC BY-SA 3.0; the result is a derived work under the same license
(see CREDITS.md and assets/ui/LICENSE.md).

  .venv/bin/python tools/build_ui_assets.py
"""
import json
import os
import shutil
import sys

from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
sys.path.insert(0, ROOT)
from game import uiskin_map as M  # noqa: E402

RAW = os.path.join(ROOT, 'assets', '0ad_raw')
if not os.path.isdir(RAW):          # from a working copy (git worktree) - the main repository is nearby
    alt = os.path.abspath(os.path.join(ROOT, '..', '..', '..', 'assets', '0ad_raw'))
    RAW = alt if os.path.isdir(alt) else RAW
TEX = os.path.join(RAW, 'public', 'art', 'textures')
UI = os.path.join(TEX, 'ui')
OUT = os.path.join(ROOT, 'assets', 'ui')
FONTS = os.path.join(ROOT, 'assets', 'fonts')
PORTRAIT = 128


def load(rel, base=UI):
    return Image.open(os.path.join(base, rel)).convert('RGBA')


def save(img, rel):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


def nine(folder):
    """Assemble the 9 pieces of a 0 A.D. button into one 272x80 template (an 8 px frame)."""
    parts = {n: load(f'{folder}/{n}.png') for n in (
        'top_left_corner', 'top_edge', 'top_right_corner', 'left_edge', 'center', 'right_edge',
        'bottom_left_corner', 'bottom_edge', 'bottom_right_corner')}
    img = Image.new('RGBA', (272, 80))
    img.paste(parts['center'], (8, 8))
    img.paste(parts['top_edge'], (8, 0))
    img.paste(parts['bottom_edge'], (8, 72))
    img.paste(parts['left_edge'], (0, 8))
    img.paste(parts['right_edge'], (264, 8))
    img.paste(parts['top_left_corner'], (0, 0))
    img.paste(parts['top_right_corner'], (264, 0))
    img.paste(parts['bottom_left_corner'], (0, 72))
    img.paste(parts['bottom_right_corner'], (264, 72))
    return img


def gold_frame():
    """A thin golden 0 A.D. frame (corners 4x4 + lines) -> a 72x72 template, a 4 px frame, a transparent center."""
    b = 'global/border/'
    img = Image.new('RGBA', (72, 72))
    h, v = load(b + 'line_horiz.png'), load(b + 'line_vert.png')
    img.paste(h, (4, 0))
    img.paste(h, (4, 68))
    img.paste(v, (0, 4))
    img.paste(v, (68, 4))
    for n, xy in (('top_left', (0, 0)), ('top_right', (68, 0)), ('bottom_left', (0, 68)), ('bottom_right', (68, 68))):
        img.paste(load(f'{b}line_corner_{n}.png'), xy)
    return img


def main():
    if not os.path.isdir(UI):
        sys.exit(f'no {UI}: run tools/fetch_0ad.py first')
    # we do not touch LICENSE.md nearby; portraits/{de,scenic,orders,units3d} - their own builds (ui_icon_art, build_portraits)
    for sub in ('skin', 'icons', 'cursors', 'portraits/structures', 'portraits/technologies', 'portraits/units',
                'portraits/gaia'):
        if os.path.isdir(os.path.join(OUT, sub)):
            shutil.rmtree(os.path.join(OUT, sub))
    # ---- trim
    for st in ('base', 'over', 'pressed'):
        save(nine(f'global/button/button_brown/{st}'), f'skin/btn_{st}.png')
    save(gold_frame(), 'skin/goldline.png')
    simple = {
        'global/tile/stone_background.png': 'skin/stone_dark.png',
        'global/tile/stone_background_light.png': 'skin/stone_light.png',
        'global/tile/tile_dark.png': 'skin/tile_dark.png',
        'session/hud_panels.png': 'skin/hud.png',
        'global/button/button_stone_selected.png': 'skin/stone_sel.png',
        'global/button/button_stone_unselected.png': 'skin/stone_unsel.png',
        'tipdisplay/button-highlight_over.png': 'skin/glow_over.png',
        'tipdisplay/button-highlight_pressed.png': 'skin/glow_pressed.png',
        'tipdisplay/title-ornament.png': 'skin/ornament.png',
        'tipdisplay/button-decoration_front.png': 'skin/deco_front.png',
        'session/golden-arrow_down.png': 'skin/arrow_down.png',
        'session/golden-arrow_left.png': 'skin/arrow_left.png',
        'session/minimap_circle_modern.png': 'skin/ring.png',
        'session/ribbon_bg.png': 'skin/ribbon.png',
    }
    for src, dst in simple.items():
        save(load(src), dst)
    save(load('tipdisplay/parchment.png').crop((0, 0, 316, 386)), 'skin/parchment.png')   # a sheet without an empty margin
    # crest discs (the menu background)
    for n in ('brit', 'celt', 'germ', 'goth', 'iber', 'rome', 'han', 'achae'):
        save(load(f'session/icons/bkg/background_circle_{n}.png').resize((320, 320), Image.LANCZOS),
             f'skin/disc_{n}.png')
    # ---- icons
    for r in ('food', 'wood', 'stone', 'metal', 'population'):
        save(load(f'session/icons/resources/{r}.png').resize((48, 48), Image.LANCZOS), f'icons/{r}.png')
    save(load('session/icons/resources/time_small.png'), 'icons/time.png')
    for n in ('bribes', 'diplomacy', 'bell_level1', 'bell_level2', 'call-to-arms', 'cancel', 'garrison-out', 'garrison', 'stop', 'repair',
              'production', 'promote', 'upgrade', 'victory', 'defeat', 'economics', 'encyclopaedia', 'kill',
              'back-to-work', 'match-settings', 'construction', 'training', 'heal'):
        im = load(f'session/icons/{n}.png')
        if max(im.size) > 64:
            im = im.resize((64, 64), Image.LANCZOS)
        save(im, f'icons/{n}.png')
    save(load('session/icons/idle.dds'), 'icons/idle.png')
    # ---- cursors (+ the aim point from .txt). docs/research/08_cursor.md: the tip = the aim point.
    hot = {}
    cur_dir = os.path.join(TEX, 'cursors')
    for n in ('action-build', 'action-repair', 'action-garrison', 'action-patrol', 'action-guard',
              'action-setup-trade-route', 'action-unload', 'cursor-flare',
              'action-gather-tree', 'action-gather-rock', 'action-gather-ore', 'action-gather-fruit',
              'action-gather-grain', 'action-gather-meat', 'action-gather-fish', 'action-return-food',
              'action-heal', 'cursor-rally'):
        save(load(n + '.png', cur_dir), f'cursors/{n}.png')
        txt = os.path.join(cur_dir, n + '.txt')
        hot[n] = [int(v) for v in open(txt).read().split()[:2]] if os.path.exists(txt) else [1, 1]
    # the 0 A.D. arrow is stored in the file with the tip down-left (the tip at (0, 31)) - flip it: the tip up-left at (0, 0)
    arrow = ImageOps.flip(load('arrow-default-down.png', cur_dir))
    save(arrow, 'cursors/arrow-default-down.png')
    hot['arrow-default-down'] = [0, 0]
    # 64x64 swords with a 23x23 drawing: cut out the box and stretch it to the whole 32 cursor (otherwise the sword is 11 px), the tip at (1, 1)
    for n in ('action-attack', 'action-attack-move'):
        im = load(n + '.png', cur_dir)
        bb = im.getchannel('A').point(lambda v: 255 if v > 30 else 0).getbbox()
        im = im.crop(bb)
        k = 30 / max(im.size)
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        out = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
        out.alpha_composite(im, (1, 1))
        save(out, f'cursors/{n}.png')
        hot[n] = [1, 1]
    # the aim point - at the center of the drawing: "no" (a cross) and "on the ground" (a target)
    for n in ('cursor-no', 'action-target'):
        im = load(n + '.png', cur_dir)
        save(im, f'cursors/{n}.png')
        bb = im.getchannel('A').point(lambda v: 255 if v > 30 else 0).getbbox()
        hot[n] = [(bb[0] + bb[2] - 1) // 2, (bb[1] + bb[3] - 1) // 2]
    # our own DE cursors (tools/ui_icon_art.py: de_*) - an object without an arrow, the working end at (1, 1)
    for n in ('tree', 'gold', 'stone', 'berries', 'farm', 'meat', 'fish', 'drop', 'heal', 'repair', 'attack',
              'amove', 'flare', 'rally', 'board', 'unload', 'follow'):
        hot[f'de_{n}'] = [1, 1]
    with open(os.path.join(OUT, 'cursors', 'hotspots.json'), 'w') as f:
        json.dump(hot, f, indent=1, sort_keys=True)
    # ---- portraits
    pdir = os.path.join(UI, 'session', 'portraits')
    need = set(M.BUILDING_PORTRAITS.values()) | set(M.GAIA_PORTRAITS.values()) | set(M.TECH_PORTRAITS.values())
    need |= set(M.AGE_PORTRAITS_0AD) | set(M.EXTRA_PORTRAITS)
    need = {n for n in need if not n.startswith(('de/', 'scenic/', 'orders/', 'units3d/'))}
    names = {n for c in M.UNIT_PORTRAITS.values() for n in c}
    dirs = set(M.FALLBACK_DIRS) | {d for ds in M.CIV_DIRS.values() for d in ds}
    for d in dirs:
        for fn in os.listdir(os.path.join(pdir, 'units', d)):
            if fn.endswith('.png') and fn[:-4] in names:
                need.add(f'units/{d}/{fn[:-4]}')
    miss = []
    for rel in sorted(need):
        src = os.path.join(pdir, rel + '.png')
        if not os.path.exists(src):
            miss.append(rel)
            continue
        im = Image.open(src).convert('RGBA')
        if im.size != (PORTRAIT, PORTRAIT):
            im = im.resize((PORTRAIT, PORTRAIT), Image.LANCZOS)
        save(im, f'portraits/{rel}.png')
    if miss:
        print('no portraits:', ', '.join(miss))
    # ---- fonts
    os.makedirs(FONTS, exist_ok=True)
    fsrc = os.path.join(RAW, 'mod', 'fonts')
    for fn in ('LinBiolinum_Rah.ttf', 'LinBiolinum_RBah.ttf', 'FreeSans.ttf', 'FreeSansBold.ttf',
               'LibBiolinum-LICENSE.txt', 'FreeFont-LICENSE.txt'):
        shutil.copy(os.path.join(fsrc, fn), os.path.join(FONTS, fn))
    # ---- icons by the DE dictionary (reassigned, composite, procedural), tool cursors, culture frames
    from tools import ui_icon_art
    ui_icon_art.build()
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(OUT) for f in fs)
    print(f'assets/ui: {sum(len(fs) for _, _, fs in os.walk(OUT))} files, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
