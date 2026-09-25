#!/usr/bin/env python3
"""A sprite sheet: all units (both sides, at rest and in a swing) and selected buildings - for checking the graphics.

  .venv/bin/python tools/sheet.py --out shots/units.png
  .venv/bin/python tools/sheet.py --out shots/blds.png --buildings university monastery castle
"""
import argparse
import os
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import UNITS, PLAYER_COLORS  # noqa: E402
from game import gfx  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/units.png')
    ap.add_argument('--k', type=float, default=2.2, help='figure scale')
    ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--buildings', nargs='*', help='instead of units - these buildings')
    a = ap.parse_args()
    pygame.init()
    pygame.display.set_mode((1, 1))
    font = pygame.font.SysFont('arial', 13)
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    if a.buildings:
        sprites = [(k, gfx.make_building_sprite(k, PLAYER_COLORS[i % 4])[0]) for i, k in enumerate(a.buildings)]
        W = sum(s.get_width() + 20 for _, s in sprites) + 20
        H = max(s.get_height() for _, s in sprites) + 50
        sheet = pygame.Surface((W, H))
        sheet.fill((96, 128, 70))
        x = 20
        for k, s in sprites:
            sheet.blit(s, (x, 10))
            sheet.blit(font.render(k, True, (255, 255, 255)), (x, H - 30))
            x += s.get_width() + 20
        pygame.image.save(sheet, a.out)
        print('saved', a.out)
        return
    kinds = [k for k in UNITS] + list(gfx.ART)
    cw, ch = int(34 * a.k) * 2 + 20, int(40 * a.k) + 30
    rows = (len(kinds) + a.cols - 1) // a.cols
    sheet = pygame.Surface((cw * a.cols, ch * rows))
    sheet.fill((96, 128, 70))
    for i, k in enumerate(kinds):
        cx, cy = (i % a.cols) * cw, (i // a.cols) * ch
        pygame.draw.rect(sheet, (86, 116, 62), (cx + 2, cy + 2, cw - 4, ch - 4), 1)
        col = PLAYER_COLORS[(i // 3) % 4]
        gfx.draw_unit(sheet, k, col, cx + cw * 0.27, cy + ch - 26, face=(1, 0), k=a.k)
        gfx.draw_unit(sheet, k, col, cx + cw * 0.73, cy + ch - 26, face=(-1, 0), swing=0.2, k=a.k)
        sheet.blit(font.render(k, True, (255, 255, 255)), (cx + 5, cy + ch - 20))
    pygame.image.save(sheet, a.out)
    print('saved', a.out)


if __name__ == '__main__':
    main()
