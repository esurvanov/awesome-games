#!/usr/bin/env python3
"""A windowless civilization "town" for checking graphics by eye: all buildings, house variants, construction,
walls with gates (finished and scaffolded), a dock at the shore, villagers and an army.

  .venv/bin/python tools/town_shot.py --civs franks,byzantines --out shots/town
Files: town_<civ>.png (the town), army_<civ>.png (the troops of the same civilization).
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

from game.data import TILE, BUILDINGS  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402
from game import naval  # noqa: E402

LAYOUT = [  # (kind, dx, dy, ready)
    ('town_center', 0, 0, True), ('house', -5, -1, True), ('house', -5, 2, True), ('house', -3, 5, True),
    ('house', 0, 5, True), ('house', 2, 5, False), ('mill', 5, 0, True), ('lumber_camp', 5, 3, True),
    ('barracks', -9, -5, True), ('archery_range', -5, -5, True), ('stable', -1, -5, True),
    ('blacksmith', 3, -5, True), ('monastery', 7, -5, True), ('market', -10, 0, True),
    ('castle', -10, 5, True), ('university', -5, 9, True), ('siege_workshop', 0, 9, True),
    ('tower', 5, 9, True), ('guard_tower', 7, 9, True), ('keep', 9, 9, True),
    ('mining_camp', 8, 3, True), ('barracks', 9, -1, False), ('farm', 5, 6, True),
]


def free(w, kind, tx, ty):
    s = BUILDINGS[kind]['size']
    for y in range(ty, ty + s):
        for x in range(tx, tx + s):
            if not (0 <= x < w.W and 0 <= y < w.H) or w.terrain[y][x] == 1 or w.occ[y][x] is not None:
                return False
    return True


def clear(w, x0, y0, x1, y1):
    for n in list(w.nodes):
        if x0 <= n.tx <= x1 and y0 <= n.ty <= y1:
            w.nodes.remove(n)
            if w.occ[n.ty][n.tx] is n:
                w.occ[n.ty][n.tx] = None
    for b in list(w.buildings):
        if x0 <= b.tx <= x1 and y0 <= b.ty <= y1:
            w.remove_building(b, rubble=False)
    for u in list(w.units):
        if x0 * TILE <= u.x <= x1 * TILE and y0 * TILE <= u.y <= y1 * TILE:
            w.units.remove(u)


def town(g, civ, out):
    random.seed(3)
    g.new_game(1, 1, False, map_type='coast', civ=civ)
    w = g.world
    w.vis = bytearray(b'\x01' * (w.W * w.H))
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    sx, sy = (int(v) for v in w.starts[0])
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    cx, cy = tc.tx, tc.ty
    clear(w, cx - 12, cy - 8, cx + 13, cy + 13)
    for kind, dx, dy, done in LAYOUT:
        tx, ty = cx + dx, cy + dy
        if kind == 'town_center':
            if free(w, kind, tx, ty):
                w.place_building(kind, 0, tx, ty, True)
            continue
        if not free(w, kind, tx, ty):
            continue
        b = w.place_building(kind, 0, tx, ty, done)
        if not done:
            b.progress = 0.55
    # walls: a stone wall line with a gate and a segment under construction
    from game import defense
    y = cy - 8
    try:
        defense.place_wall_line(w, 'stone_wall', 0, cx - 12, y, cx - 1, y)
        for b in w.buildings:
            if b.kind == 'stone_wall' and b.ty == y:
                b.progress = 1.0 if b.tx < cx - 6 else 0.3 + 0.1 * (b.tx % 5)
                b.hp = b.max_hp
        gx = cx + 1
        if all(w.occ[y][x] is None and w.terrain[y][x] != 1 for x in range(gx, gx + 4)):
            w.place_building('gate', 0, gx, y, True, size=(4, 1))
        defense.place_wall_line(w, 'palisade_wall', 0, cx + 6, y, cx + 12, y)
        for b in w.buildings:
            if b.kind == 'palisade_wall' and b.ty == y:
                b.progress = 1.0
                b.hp = b.max_hp
    except Exception as e:          # walls are not the main thing for the shot
        print('  walls:', e)
    # dock: the nearest suitable spot at the water
    best = None
    for yy in range(max(0, cy - 30), min(w.H - 3, cy + 30)):
        for xx in range(max(0, cx - 30), min(w.W - 3, cx + 30)):
            if naval.can_place_water(w, 'dock', xx, yy, 0, False):
                d = abs(xx - cx) + abs(yy - cy)
                if best is None or d < best[0]:
                    best = (d, xx, yy)
    for b in w.buildings:
        b.seen = True
    w.fog_version += 1
    w.amat[0] = [True] * len(w.amat[0])
    vils = [u for u in w.units if u.owner == 0 and u.kind == 'villager']
    for i, u in enumerate(vils):
        u.x, u.y = (cx + 2 + i % 4) * TILE, (cy + 4.5 + i // 4) * TILE
    g.center_on((cx + 1) * TILE, (cy + 2) * TILE)
    g.selected = []
    g.draw()
    pygame.image.save(g.screen, os.path.join(out, f'town_{civ}.png'))
    print('saved', os.path.join(out, f'town_{civ}.png'))
    if best:
        _, xx, yy = best
        w.place_building('dock', 0, xx, yy, True)
        xx2 = None
        for (d, x2, y2) in [(0, xx + dx, yy + dy) for dx in range(-12, 13, 4) for dy in range(-12, 13, 4)]:
            if naval.can_place_water(w, 'dock', x2, y2, 0, False):
                xx2 = (x2, y2)
                w.place_building('dock', 0, x2, y2, False).progress = 0.5
                break
        for i, k in enumerate(('fishing_ship', 'transport_ship', 'galley', 'war_galley')):
            wt = naval.nearest_water_tile(w, xx + 1 + i * 2, yy + 5)
            u = naval.Ship(k, 0, (wt[0] + 0.5) * TILE, (wt[1] + 0.5) * TILE, w)
            w.units.append(u)
        g.center_on((xx + 1.5) * TILE, (yy + 1.5) * TILE)
        g.draw()
        pygame.image.save(g.screen, os.path.join(out, f'dock_{civ}.png'))
        print('saved', os.path.join(out, f'dock_{civ}.png'), 'dock', (xx, yy), naval.dock_land(w, xx, yy, 3), xx2)
    # docks at the shores of all four directions (a sprite rotation check)
    tiles = []
    for want in ((1, 0), (0, 1), (-1, 0), (0, -1)):
        spot = None
        for yy in range(2, w.H - 5, 2):
            for xx in range(2, w.W - 5, 2):
                if naval.can_place_water(w, 'dock', xx, yy, 0, False) and naval.dock_land(w, xx, yy, 3) == want:
                    d = abs(xx - cx) + abs(yy - cy)
                    if spot is None or d < spot[0]:
                        spot = (d, xx, yy)
        if spot is None:
            continue
        _, xx, yy = spot
        w.place_building('dock', 0, xx, yy, True)
        g.center_on((xx + 1.5) * TILE, (yy + 1.5) * TILE)
        g.draw()
        v = g.screen.subsurface(pygame.Rect(g.screen.get_width() // 2 - 200, 200, 400, 260)).copy()
        tiles.append(v)
    if tiles:
        sheet = pygame.Surface((400 * len(tiles), 260))
        for i, t in enumerate(tiles):
            sheet.blit(t, (i * 400, 0))
        pygame.image.save(sheet, os.path.join(out, f'docks4_{civ}.png'))



RANKS = ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion', 'hand_cannoneer', 'bombard_cannon',
         'spearman', 'pikeman', 'halberdier', 'archer', 'crossbowman', 'arbalester', 'skirmisher',
         'scout', 'light_cavalry', 'hussar', 'knight', 'cavalier', 'paladin', 'elite_skirmisher']


def army(g, civ, out, ranks=False):
    w = g.world
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    def land(x0, y0):
        return all(0 <= x < w.W and 0 <= y < w.H and w.terrain[y][x] != 1
                   for y in range(y0 - 6, y0 + 8) for x in range(x0 - 8, x0 + 12))
    spots = sorted(((abs(dx) + abs(dy), tc.tx + dx, tc.ty + dy) for dx in range(-40, 41, 3)
                    for dy in range(-40, 41, 3) if abs(dx) + abs(dy) >= 18), key=lambda t: t[0])
    cx, cy = next(((x, y) for _, x, y in spots if land(x, y)), (tc.tx + 2, tc.ty + 16))
    clear(w, cx - 8, cy - 6, cx + 12, cy + 8)
    kinds = ['villager', 'militia', 'long_swordsman', 'spearman', 'pikeman', 'archer', 'crossbowman', 'skirmisher',
             'scout', 'knight', 'paladin', 'cavalry_archer', 'monk', 'trade_cart', 'ram', 'mangonel', 'trebuchet',
             'scorpion']
    from game import civ_ui
    kinds += list(civ_ui.unique_units(civ))
    before = set(map(id, w.units))
    if ranks:
        kinds = RANKS          # rank lines (wounded - health bars are visible over the head)
    for i, k in enumerate(kinds):
        x, y = cx - 6 + (i % 7) * 2.6, cy - 4 + (i // 7) * 3.2
        for j in range(3 if k == 'villager' else 1):
            u = Unit(k, 0, (x + j * 0.8) * TILE, y * TILE, w)
            if ranks:
                u.hp = u.max_hp * 0.6
            w.units.append(u)
    g.center_on((cx + 1) * TILE, cy * TILE)
    g.draw()
    fn = os.path.join(out, f'{"ranks" if ranks else "army"}_{civ}.png')
    pygame.image.save(g.screen, fn)
    print('saved', fn)
    w.units[:] = [u for u in w.units if id(u) in before]      # the next shot - on a clean spot


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/town')
    ap.add_argument('--civs', default='franks')
    ap.add_argument('--no-army', action='store_true')
    ap.add_argument('--ranks', action='store_true', help='one more shot of the rank lines (ranks_<civ>.png)')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    g = Game()
    for civ in a.civs.split(','):
        town(g, civ, a.out)
        if not a.no_army:
            army(g, civ, a.out)
        if a.ranks:
            army(g, civ, a.out, ranks=True)
    pygame.quit()


if __name__ == '__main__':
    main()
