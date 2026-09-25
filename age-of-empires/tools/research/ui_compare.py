#!/usr/bin/env python3
"""Пары «наш значок | эталон DE» (исследование; эталоны DE — только локально в shots/ref, в игру не идут).
  ui_compare.py all                 — shots/research_ui/pairs_NN.png: все вырезки с эталоном рядом
  ui_compare.py worst <scores.json> — shots/research_ui/side_by_side.png: 30 хуже всего узнаваемых
Эталоны: shots/ref/de_icons/named (набор aoe2techtree), shots/ref/de_ui_mods (текстуры модов DE),
кадры DE в shots/ref/hud (вырезаются по координатам ниже).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
ITEMS = os.path.join(ROOT, 'shots/research_ui/items')
NAMED = os.path.join(ROOT, 'shots/ref/de_icons/named')
MODS = os.path.join(ROOT, 'shots/ref/de_ui_mods')
ACT = os.path.join(MODS, 'age2de-ui/Ch4nKyy_IconHotkeys/widgetui/textures/ingame/actions')
ICONS = os.path.join(MODS, 'dani-ui-age2de/widgetui/textures/ingame/icons')
HUD = os.path.join(ROOT, 'shots/ref/hud')
AGES = os.path.join(ROOT, 'shots/ref/de_icons/repo/img/Ages')


def title(k):
    return '_'.join(w.capitalize() if w not in ('at',) else w for w in k.split('_'))


UNIT_FIX = {'scout': 'Scout_Cavalry', 'ram': 'Battering_Ram', 'man_at_arms': 'Man_at_Arms'}
TECH_FIX = {'double_bit': 'Double_Bit_Axe', 'scale_armor': 'Scale_Mail_Armor', 'scale_barding': 'Scale_Barding_Armor',
            'fortified_wall': 'Fortified_Wall', 'guard_tower': 'Guard_Tower'}
UPGRADES = {'man_at_arms', 'pikeman', 'crossbowman', 'elite_skirmisher', 'heavy_cavalry_archer', 'light_cavalry',
            'cavalier', 'capped_ram', 'onager', 'heavy_scorpion', 'war_galley', 'fire_ship', 'heavy_demolition_ship',
            'elite_longbowman'}
# кадр DE (fd_onager.png): сетка армии 5×2, шаг ≈ 48.7 px от (24, 577), ячейка 41 px
ARMY_GRID = {'patrol': (0, 0), 'guard': (1, 0), 'follow': (2, 0), 'amove': (3, 0), 'aground': (4, 0),
             'aggressive_on': (0, 1), 'defensive': (1, 1), 'stand_ground': (2, 1), 'no_attack': (3, 1),
             'stop': (4, 1)}
ACTIONS = {'line_on': '065', 'box': '043', 'staggered': '062', 'flank': '063', 'next': '032', 'back': '000',
           'barracks': '031', 'house': '030', 'mill_Пересев фермы': '071', 'market_Купить: еда': '019',
           'market_Продать: дерево': '018', 'trebuchet_up': '013', 'bell': None}
TOP_DE = {'objectives': 0, 'chat': 1, 'diplomacy': 2, 'techtree': 3, 'menu': 4}   # c_tr.png, кнопки по x
MM_DE = {'flare': (1197, 63), 'score': (1494, 63), 'colors': (1197, 158), 'mode': (1494, 158)}  # c1_bottom.png
RES_DE = {'wood': 'resource_wood', 'food': 'resource_food', 'gold': 'resource_gold', 'stone': 'resource_stone',
          'pop': 'pop', 'idle': 'idle-villager_normal'}
RES_TOP_X = {'wood': 48, 'food': 228, 'gold': 407, 'stone': 584, 'pop': 762, 'idle': 962}
AGE_DE = {'dark': 'base_dark_age', 'feudal': 'base_feudal_age', 'castle': 'base_castle_age',
          'imperial': 'base_imperial_age'}
STAT_DE = {'atk': (386, 606, 13), 'arm': (387, 629, 13), 'rng': (387, 657, 13), 'spd': (491, 603, 13),
           'reload': (388, 710, 13), 'blast': (387, 684, 13)}  # fd_onager.png


def _open(p):
    try:
        return Image.open(p).convert('RGBA')
    except Exception:          # noqa: BLE001
        return None


def de_ref(fn):
    """Эталон DE для вырезки или None."""
    base = fn[:-4]
    cat, key = base.split('__', 1)
    sub = key.split('.', 1)[-1]
    if sub == 'trebuchet_up':
        return _open(os.path.join(ACT, '013_.png'))
    if cat in ('unit', 'port'):
        n = UNIT_FIX.get(sub, title(sub))
        return _open(os.path.join(NAMED, f'Unit_{n}.png'))
    if cat == 'tech':
        if sub in UPGRADES:
            return _open(os.path.join(NAMED, f'Unit_{UNIT_FIX.get(sub, title(sub))}.png'))
        return _open(os.path.join(NAMED, f'Tech_{TECH_FIX.get(sub, title(sub))}.png'))
    if cat in ('bld', 'portb'):
        return _open(os.path.join(NAMED, f'Building_{title(sub)}.png'))
    if cat == 'age':
        if '.' in key:
            return _open(os.path.join(NAMED, f'Tech_{title(sub)}_Age.png'))
        return _open(os.path.join(AGES, AGE_DE[sub] + '.png'))
    if cat == 'res':
        im = _open(os.path.join(HUD, 'c_top.png'))      # верхняя полоса DE 1480×100
        x = RES_TOP_X[sub]
        return im.crop((x - 34, 12, x + 34, 88)) if im else None
    if cat == 'top' and sub in TOP_DE:
        im = _open(os.path.join(HUD, 'c_tr.png'))
        cx = 257 + TOP_DE[sub] * 77.5
        return im.crop((int(cx) - 30, 20, int(cx) + 30, 80)) if im else None
    if cat == 'top' and sub == 'civ_banner':
        im = _open(os.path.join(HUD, 'c_tr.png'))
        return im.crop((80, 0, 150, 100)) if im else None
    if cat == 'mm':
        im = _open(os.path.join(HUD, 'c1_bottom.png'))
        x, y = MM_DE[sub]
        return im.crop((x - 26, y - 26, x + 26, y + 26)) if im else None
    if cat == 'stat' and sub in STAT_DE:
        im = _open(os.path.join(HUD, 'fd_onager.png'))
        x, y, r = STAT_DE[sub]
        return im.crop((x - r, y - r, x + r, y + r)) if im else None
    if cat == 'cmd':
        if sub in ARMY_GRID:
            im = _open(os.path.join(HUD, 'fd_onager.png'))
            c, r = ARMY_GRID[sub]
            x, y = 24 + c * 48.7, 577 + r * 48.7
            return im.crop((int(x), int(y), int(x) + 42, int(y) + 42)) if im else None
        a = ACTIONS.get(sub)
        if a:
            return _open(os.path.join(ACT, f'{a}_.png'))
    return None


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc'):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def pair_sheet(rows, out, cols=4, label=None):
    """rows: [(файл, подпись)]. Клетка: наш ×2 | DE (приведён к той же высоте)."""
    cw, ch = 300, 150
    n = len(rows)
    sheet = Image.new('RGB', (cols * cw, ((n + cols - 1) // cols) * ch + (40 if label else 0)), (52, 48, 44))
    d = ImageDraw.Draw(sheet)
    f, fb = font(14), font(20)
    y0 = 0
    if label:
        d.text((10, 8), label, fill=(255, 230, 150), font=fb)
        y0 = 40
    for i, (fn, cap) in enumerate(rows):
        x, y = (i % cols) * cw, y0 + (i // cols) * ch
        ours = _open(os.path.join(ITEMS, fn))
        de = de_ref(fn)
        box = 104
        if ours:
            k = box / max(ours.size)
            o = ours.resize((max(1, int(ours.width * k)), max(1, int(ours.height * k))), Image.LANCZOS)
            sheet.paste(o, (x + 8, y + 6), o)
        d.text((x + 8, y + 114), 'наш', fill=(180, 220, 255), font=f)
        if de:
            k = box / max(de.size)
            dd = de.resize((max(1, int(de.width * k)), max(1, int(de.height * k))), Image.LANCZOS)
            bg = Image.new('RGBA', dd.size, (0, 0, 0, 255))
            bg.alpha_composite(dd)
            sheet.paste(bg, (x + 150, y + 6))
            d.text((x + 150, y + 114), 'DE', fill=(255, 200, 120), font=f)
        else:
            d.text((x + 160, y + 50), 'нет эталона', fill=(150, 150, 150), font=f)
        d.text((x + 8, y + 130), cap[:40], fill=(255, 255, 255), font=f)
    sheet.save(out)
    return out


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'all'
    outdir = os.path.join(ROOT, 'shots/research_ui')
    if mode == 'all':
        files = sorted(f for f in os.listdir(os.path.join(ROOT, 'shots/research_ui/blind'))
                       if f.endswith('.png') and not f.startswith('sheet'))
        key = json.load(open(os.path.join(ROOT, 'shots/research_ui/blind/_key.json')))
        rows = [(key[f[:-4]], key[f[:-4]][:-4]) for f in files]
        rows.sort(key=lambda r: r[0])
        per = 24
        for s in range(0, len(rows), per):
            print(pair_sheet(rows[s:s + per], os.path.join(outdir, f'pairs_{s // per:02d}.png')))
    elif mode == 'worst':
        sc = json.load(open(sys.argv[2]))
        worst = [r for r in sc if r.get('worst_rank')]
        worst.sort(key=lambda r: r['worst_rank'])
        rows = [(r['file'], f"{r['worst_rank']}. {r['name']}") for r in worst[:30]]
        print(pair_sheet(rows, os.path.join(outdir, 'side_by_side.png'), cols=5,
                         label='30 наименее узнаваемых: слева наш значок, справа — как в AoE2 DE'))


if __name__ == '__main__':
    main()
