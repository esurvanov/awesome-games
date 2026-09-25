#!/usr/bin/env python3
"""Безоконные скриншоты цивилизаций: меню с выбором, лист уникальных юнитов, карточка в игре, бой уникальных.

  .venv/bin/python tools/civ_shot.py --out shots/civ
Файлы: menu_civ.png, units_civ.png (обычные и элитные, покой и замах), emblems.png, overlay.png, battle_civ.png.
"""
import argparse
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import UNITS, PLAYER_COLORS, TILE, CIVS  # noqa: E402
from game import gfx, civ_ui  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402


def unit_sheet(path, k=2.4):
    kinds = []
    for key in civ_ui.playable():
        for u in civ_ui.unique_units(key):
            kinds += [u, 'elite_' + u]
    font = pygame.font.SysFont('arial', 13)
    cols = 4
    cw, ch = int(46 * k) * 2 + 10, int(58 * k) + 26
    rows = (len(kinds) + cols - 1) // cols
    sheet = pygame.Surface((cw * cols, ch * rows))
    sheet.fill((96, 128, 70))
    for i, kd in enumerate(kinds):
        cx, cy = (i % cols) * cw, (i // cols) * ch
        pygame.draw.rect(sheet, (86, 116, 62), (cx + 2, cy + 2, cw - 4, ch - 4), 1)
        col = PLAYER_COLORS[(i // 2) % 4]
        gfx.draw_unit(sheet, kd, col, cx + cw * 0.27, cy + ch - 24, face=(1, 0), k=k)
        gfx.draw_unit(sheet, kd, col, cx + cw * 0.73, cy + ch - 24, face=(-1, 0), swing=0.2, k=k)
        sheet.blit(font.render(UNITS[kd]['name'], True, (255, 255, 255)), (cx + 5, cy + ch - 18))
    pygame.image.save(sheet, path)
    print('сохранено', path)


def emblem_sheet(path):
    keys = civ_ui.playable() + ['random']
    font = pygame.font.SysFont('arial', 14)
    sheet = pygame.Surface((len(keys) * 110 // 2 + 20, 2 * 150))
    sheet.fill((50, 42, 34))
    for i, key in enumerate(keys):
        x, y = 15 + (i % ((len(keys) + 1) // 2)) * 110, 10 + (i // ((len(keys) + 1) // 2)) * 145
        spec = CIVS[key]['emblem'] if key in CIVS else civ_ui.RANDOM_SPEC
        from game import civ_art
        civ_art.draw_emblem(sheet, (x, y, 90, 108), spec)
        sheet.blit(font.render(civ_ui.civ_name(key), True, (255, 240, 210)), (x, y + 114))
    pygame.image.save(sheet, path)
    print('сохранено', path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/civ')
    ap.add_argument('--civ', default='persians', help='цивилизация для карточки и боя')
    ap.add_argument('--enemy', default='teutons')
    ap.add_argument('--seed', type=int, default=2)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(a.seed)
    g = Game()
    # меню: курсор над гербом выбранной цивилизации
    g.menu_cfg['civ'] = a.civ
    r = next(r for r, act, v in civ_ui.menu_items() if v == 'franks')
    pygame.mouse.set_pos(r.center)
    g.draw_menu()
    pygame.image.save(g.screen, os.path.join(a.out, 'menu_civ.png'))
    print('сохранено', os.path.join(a.out, 'menu_civ.png'))
    unit_sheet(os.path.join(a.out, 'units_civ.png'))
    emblem_sheet(os.path.join(a.out, 'emblems.png'))
    # игра: карточка цивилизации
    g.new_game(1, 1, civs=[a.civ, a.enemy])
    w = g.world
    g.help = 'civ'
    g.draw()
    pygame.image.save(g.screen, os.path.join(a.out, 'overlay.png'))
    print('сохранено', os.path.join(a.out, 'overlay.png'))
    g.help = False
    # замок: кнопки уникального юнита, элиты и технологий
    p = w.players[0]
    for t in ('feudal', 'castle', 'imperial'):
        w.apply_tech(p, t)
    p.res.update(food=5000, wood=5000, gold=5000, stone=5000)
    sx, sy = w.starts[0]
    cs = None
    for r in range(6, 14):
        for dx in range(-r, r + 1):
            if cs is None and w.can_place('castle', sx + dx, sy + r, 0, check_explored=False):
                cs = w.place_building('castle', 0, sx + dx, sy + r, complete=True)
    if cs is not None:
        g.center_on(*cs.center())
        g.selected = [cs]
        g.draw()
        bt = next((b for b in g.get_buttons() if b['act'][0] == 'train'), None)
        if bt:
            g.draw_tooltip(bt)
        pygame.image.save(g.screen, os.path.join(a.out, 'castle.png'))
        print('сохранено', os.path.join(a.out, 'castle.png'))
        g.selected = []
    # бой уникальных юнитов посреди карты (видно всё)
    w.ais = []
    cx, cy = w.W // 2 * TILE, w.H // 2 * TILE
    for y in range(w.H // 2 - 8, w.H // 2 + 8):
        for x in range(w.W // 2 - 10, w.W // 2 + 10):
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]
    w.vis = bytearray(b'\x01' * (w.W * w.H))
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    w.fog_version += 1
    g.fog_full = None
    g.build_terrain()
    mine = []
    uu0 = civ_ui.unique_units(a.civ)[0]
    uu1 = civ_ui.unique_units(a.enemy)[0]
    kinds0 = [uu0, 'elite_' + uu0, uu0, 'chu_ko_nu', 'longbowman', 'samurai', 'mangudai', 'janissary']
    kinds1 = [uu1, 'elite_' + uu1, 'huskarl', 'berserk', 'mameluke', 'cataphract', 'throwing_axeman', 'woad_raider']
    for i, kd in enumerate(kinds0):
        u = Unit(kd, 0, cx - 90 + (i % 2) * 34, cy - 110 + i * 30, w)
        w.units.append(u)
        mine.append(u)
    for i, kd in enumerate(kinds1 + ['conquistador', 'teutonic_knight']):
        u = Unit(kd, 1, cx + 90 - (i % 2) * 34, cy - 130 + i * 27, w)
        w.units.append(u)
    for u in w.units:
        if u.owner in (0, 1) and u.cls != 'vil' and abs(u.x - cx) < 200:
            e = min((o for o in w.units if o.owner != u.owner and abs(o.x - cx) < 200),
                    key=lambda o: (o.x - u.x) ** 2 + (o.y - u.y) ** 2)
            u.cmd_attack(e)
    t = 0
    while t < 5.5:
        w.update(0.034)
        w.events.clear()
        t += 0.034
    g.center_on(cx, cy)
    g.selected = [u for u in mine if u.alive][:1]
    g.draw()
    pygame.image.save(g.screen, os.path.join(a.out, 'battle_civ.png'))
    print('сохранено', os.path.join(a.out, 'battle_civ.png'))
    pygame.quit()


if __name__ == '__main__':
    main()
