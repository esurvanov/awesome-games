#!/usr/bin/env python3
"""Исследование «перевёрнутое и не туда указывает» (docs/research/09_flipped_and_pointing.md), части A/D/E в игре:
1) 16 копейщиков идут из центра в 16 направлений — снимок с красными стрелками движения (взгляд vs движение
   в реальном кадре игры, с рельефом); 2) карта попаданий щелчка (entity_at) сеткой вокруг рыцаря и требушета;
3) свет склонов: яркость земли на склонах, обращённых к солнцу (справа-сверху), против остальных;
4) итоговый лист shots/research_flip/sheet.png (контактный лист направлений + снимок + карта попаданий).
Ничего в игре не меняет.

  SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy .venv/bin/python tools/research/flip_hud.py
"""
import json
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import numpy as np  # noqa: E402
import pygame  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

from game.data import TILE, SCREEN_W, SCREEN_H, TOP_H, PANEL_H  # noqa: E402
from game import terrain_gfx, ui as gui  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'shots', 'research_flip')
from flip_pointing import reveal, run, flat_spot, hilliest, c2s  # noqa: E402
from flip_sheet import font  # noqa: E402


def shot(g, name):
    g.draw()
    path = os.path.join(OUT, name)
    pygame.image.save(g.screen, path)
    return path


# ============================================================ 1. 16 направлений в игре
def walk16(g, spot):
    w = g.world
    cx, cy = (spot[0] + 0.5) * TILE, (spot[1] + 0.5) * TILE
    units = []
    for d in range(16):
        a = d * math.tau / 16
        u = Unit('spearman', 0, cx + math.cos(a) * 2 * TILE, cy + math.sin(a) * 2 * TILE, w)
        w.units.append(u)
        units.append((u, a))
    for u, a in units:
        u.dest = (cx + math.cos(a) * 7 * TILE, cy + math.sin(a) * 7 * TILE)
        u.path = []
        u.state = 'move'
    g.set_zoom(1.4)
    g.center_on(cx, cy)
    run(g, 2.2)
    g.center_on(cx, cy)
    path = shot(g, 'walk16_raw.png')
    im = Image.open(path).convert('RGB')
    dr = ImageDraw.Draw(im)
    ok = 0
    for u, a in units:
        sx, sy = g.w2s(u.x, u.y)
        fx, fy = u.face
        ex, ey = fx - fy, (fx + fy) / 2
        L = math.hypot(ex, ey) or 1
        ex, ey = ex / L * 34, ey / L * 34
        dr.line([(sx, sy), (sx + ex, sy + ey)], fill=(255, 40, 40), width=3)
        dr.ellipse((sx - 3, sy - 3, sx + 3, sy + 3), fill=(255, 255, 0))
        # взгляд совпадает с направлением движения?
        want = (math.cos(a), math.sin(a))
        ok += (fx * want[0] + fy * want[1]) > 0.9
        us = gui._uset(u, g.civ_of(0))
        dr.text((sx + 8, sy - us.bh - 14), f'd{us.face(fx, fy)}', fill=(255, 255, 200), font=font(13))
    dr.text((10, TOP_H + 6), 'копейщики идут из центра в 16 направлений; красная стрелка = вектор движения (u.face)',
            fill=(255, 255, 255), font=font(13))
    im = im.crop((0, TOP_H, SCREEN_W, SCREEN_H - PANEL_H))
    im.save(os.path.join(OUT, 'walk16.png'))
    for u, _ in units:
        w.units.remove(u)
    return ok


# ============================================================ 2. карта попаданий щелчка
def click_map(g, spot, kinds=('knight', 'trebuchet', 'villager')):
    w = g.world
    g.set_zoom(1.0)
    cx, cy = (spot[0] + 0.5) * TILE, (spot[1] + 0.5) * TILE
    units = []
    for i, k in enumerate(kinds):
        u = Unit(k, 0, cx + (i - 1) * 5 * TILE, cy - (i - 1) * 5 * TILE, w)
        u.face = (0.7, 0.7) if k != 'trebuchet' else (1.0, 0.0)
        w.units.append(u)
        units.append(u)
    g.center_on(cx, cy)
    g.selected = []
    path = shot(g, 'clickmap_raw.png')
    im = Image.open(path).convert('RGB')
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    stats = {}
    for u in units:
        sx, sy = g.w2s(u.x, u.y)
        us = gui._uset(u, g.civ_of(0))
        name, k = gui.unit_pose(u, us, w.time, False)
        spr, ax, ay = us.frame(us.index(name, us.face(*u.face), k), g.pcolor(0))
        a = pygame.surfarray.pixels_alpha(spr).T >= 128
        del spr
        hit = miss = false = 0
        x0, x1 = int(sx) - ax - 14, int(sx) - ax + a.shape[1] + 14
        y0, y1 = int(sy) - ay - 14, int(sy) - ay + a.shape[0] + 14
        for py in range(y0, y1, 3):
            for px in range(x0, x1, 3):
                lx, ly = px - (int(sx) - ax), py - (int(sy) - ay)
                body = 0 <= lx < a.shape[1] and 0 <= ly < a.shape[0] and a[ly, lx]
                got = g.entity_at((px + 0.5, py + 0.5)) is u
                if body and got:
                    c, hit = (40, 255, 40, 150), hit + 1
                elif body:
                    c, miss = (255, 40, 40, 200), miss + 1
                elif got:
                    c, false = (255, 220, 40, 110), false + 1
                else:
                    continue
                dr.rectangle((px, py, px + 2, py + 2), fill=c)
        stats[u.kind] = (hit, miss, false)
        dr.text((int(sx) - 40, y1 + 4), f'{u.kind}: тело попал {hit} / мимо {miss}, ложно рядом {false}',
                fill=(255, 255, 255, 255), font=font(13))
    im = Image.alpha_composite(im.convert('RGBA'), ov).convert('RGB')
    ImageDraw.Draw(im).text((10, TOP_H + 6), 'щелчок сеткой 3 px: зелёный — по телу попал, красный — по телу мимо, '
                                             'жёлтый — рядом с телом, но выбирает', fill=(255, 255, 255), font=font(13))
    im = im.crop((0, TOP_H, SCREEN_W, SCREEN_H - PANEL_H))
    im.save(os.path.join(OUT, 'clickmap.png'))
    for u in units:
        w.units.remove(u)
    return stats


# ============================================================ 3. свет склонов
def slope_light(g):
    """По вершинам рельефа: множитель света (terrain_gfx._vertex_light) на склонах, у которых спуск идёт
    вправо-вниз/вправо-вверх по экрану (нормаль +x / −y мира) — должны быть светлее 1; и пиксели земли:
    средняя яркость terrain_surf у таких вершин vs у противоположных."""
    w = g.world
    hz = np.array(w.hz, np.float64)
    L = terrain_gfx._vertex_light(hz)
    h = hz / terrain_gfx.ZK
    gx = np.zeros_like(h)
    gy = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    # экранная горизонталь нормали: n = (−gx, −gy) → экран x = −gx + gy
    scr_x = -gx + gy
    lit = L[scr_x > 0.15]
    dark = L[scr_x < -0.15]
    res = f'формула: склоны нормалью вправо по экрану: свет {lit.mean():.2f} (n={len(lit)}), влево: {dark.mean():.2f} (n={len(dark)})'
    # пиксели: яркость земли вокруг вершин
    surf = g.terrain_surf
    arr = pygame.surfarray.array3d(surf).transpose(1, 0, 2).astype(np.float32).mean(2)
    def bright(mask):
        ys, xs = np.nonzero(mask)
        vals = []
        for y, x in zip(ys, xs):
            ix, iy = gui.to_iso(x * TILE, y * TILE, g.iso_ox, hz[y, x])
            ix, iy = int(ix), int(iy)
            if 4 <= ix < arr.shape[1] - 4 and 4 <= iy < arr.shape[0] - 4:
                vals.append(arr[iy - 3:iy + 4, ix - 3:ix + 4].mean())
        return float(np.mean(vals)) if vals else float('nan'), len(vals)
    bl, nl = bright(scr_x > 0.15)
    bd, nd = bright(scr_x < -0.15)
    bf, nf = bright((np.abs(gx) < 0.02) & (np.abs(gy) < 0.02))
    return res + f'; пиксели земли: к солнцу {bl:.0f}, от солнца {bd:.0f}, равнина {bf:.0f} (0..255)'


# ============================================================ 4. итоговый лист
def compose(walk_ok, stats, light):
    parts = [Image.open(os.path.join(OUT, 'sheet_dirs.png')).convert('RGB'),
             Image.open(os.path.join(OUT, 'walk16.png')).convert('RGB'),
             Image.open(os.path.join(OUT, 'clickmap.png')).convert('RGB')]
    W = max(p.width for p in parts)
    pad = 26
    H = sum(p.height + pad for p in parts) + 60
    img = Image.new('RGB', (W, H), (30, 30, 30))
    dr = ImageDraw.Draw(img)
    y = 6
    titles = ['A. Листы: 16 направлений набора (d = угол взгляда в мире), красная стрелка — куда идёт юнит с таким '
              'face на экране, чёрная — тень',
              f'A. В игре (zoom 1.4, рельеф): взгляд вдоль движения у {walk_ok}/16',
              'D. Карта попаданий щелчка (entity_at): ' + ', '.join(f'{k}: {v[0]} попал / {v[1]} мимо / {v[2]} ложно' for k, v in stats.items())]
    for p, t in zip(parts, titles):
        dr.text((8, y), t, fill=(255, 240, 200), font=font(13))
        y += pad - 8
        img.paste(p, (0, y))
        y += p.height + 8
    dr.text((8, y), 'E. ' + light, fill=(255, 240, 200), font=font(13))
    img.save(os.path.join(OUT, 'sheet.png'))


def main():
    random.seed(11)
    os.makedirs(OUT, exist_ok=True)
    g = Game()
    g.mods = lambda: 0
    g.new_game(1, opponents=1, map_type='land', civ='franks')
    w = g.world
    w.ais = []
    reveal(w)
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    for u in list(w.units):
        if u.owner == 0:
            w.units.remove(u)
    flat = flat_spot(w, tc)
    ok = walk16(g, flat)
    print('walk16: взгляд вдоль движения у', ok, '/ 16')
    st = click_map(g, flat)
    print('clickmap:', st)
    light = slope_light(g)
    print('slope light:', light)
    compose(ok, st, light)
    with open(os.path.join(OUT, 'hud.json'), 'w', encoding='utf-8') as f:
        json.dump(dict(walk16_ok=ok, clickmap=st, light=light), f, ensure_ascii=False, indent=1)
    print('лист:', os.path.join(OUT, 'sheet.png'))
    pygame.quit()


if __name__ == '__main__':
    main()
