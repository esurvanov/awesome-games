#!/usr/bin/env python3
"""Постановочные снимки мелкой графики мира (tools/build_decals.py → game/sprites_extra.py).

  .venv/bin/python tools/decal_shot.py --out shots/decals
Файлы: coast.png — берег с рыбой (у берега и в глубине); land.png — туши на трёх стадиях разделки,
пни, развалины разных размеров (свежие догорают), горящие здания, лучники и метатели в бою, взрыв;
zoom_*.png — те же места крупно (×2).
"""
import argparse
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import TILE, SCREEN_W, VIEW_H, TOP_H  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit, Animal  # noqa: E402


def reveal(w):
    w.vis = bytearray(b'\x01' * (w.W * w.H))
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    for b in w.buildings:
        b.seen = True
    w.fog_version += 1
    w.amat[0] = [True] * len(w.amat[0])


def save(g, path, zoom_at=None):
    g.draw()
    pygame.image.save(g.screen, path)
    print('сохранено', path)
    if zoom_at:
        x, y = zoom_at
        r = pygame.Rect(0, 0, SCREEN_W // 2, VIEW_H // 2)
        r.center = (x, y)
        r.clamp_ip(pygame.Rect(0, TOP_H, SCREEN_W, VIEW_H))
        z = pygame.transform.scale(g.screen.subsurface(r).copy(), (r.w * 2, r.h * 2))
        zp = os.path.join(os.path.dirname(path), 'zoom_' + os.path.basename(path))
        pygame.image.save(z, zp)
        print('сохранено', zp)


def run(w, sec):
    t = 0.0
    while t < sec:
        w.update(0.034)
        w.events.clear()
        t += 0.034


def free(w, tx, ty):
    return 0 <= tx < w.W and 0 <= ty < w.H and w.terrain[ty][tx] == 0 and w.occ[ty][tx] is None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/decals')
    ap.add_argument('--seed', type=int, default=4)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(a.seed)
    g = Game()
    g.new_game(1, 1, False, map_type='coast')
    w = g.world
    w.ais = []
    reveal(w)
    run(w, 0.5)
    # ---------------------------------------------------------------- берег
    sx, sy = w.starts[0]
    fish = [n for n in w.nodes if n.kind in ('shore_fish', 'deep_fish')]
    if fish:
        f = min(fish, key=lambda n: abs(n.tx - sx) + abs(n.ty - sy))
        g.center_on((f.tx + 0.5) * TILE, (f.ty + 0.5) * TILE)
        save(g, os.path.join(a.out, 'coast.png'), (SCREEN_W // 2, TOP_H + VIEW_H // 2))
        deep = [n for n in fish if n.kind == 'deep_fish']
        if deep:
            d = min(deep, key=lambda n: abs(n.tx - f.tx) + abs(n.ty - f.ty))
            g.center_on((d.tx + 0.5) * TILE, (d.ty + 0.5) * TILE)
            save(g, os.path.join(a.out, 'deep.png'), (SCREEN_W // 2, TOP_H + VIEW_H // 2))
    # ---------------------------------------------------------------- суша у центра
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    cx, cy = tc.tx + 2, tc.ty + 2
    # горящие здания: центр (< 25 %) и ближайший дом (< 50 %)
    tc.hp = tc.max_hp * 0.2
    for b in w.buildings:
        if b.owner == 0 and b.kind == 'house':
            b.hp = b.max_hp * 0.4
    # развалины: 4 размера, разного возраста (свежие ещё горят)
    spots = [(cx - 9, cy + 4, 1, 'tower', 2.0), (cx - 8, cy + 6, 2, 'house', 4.0), (cx - 5, cy + 7, 3, 'barracks', 14.0),
             (cx - 2, cy + 8, 4, 'castle', 21.0)]
    for tx, ty, s, kind, age in spots:
        w.decals.append(['rubble', tx, ty, s, w.time - age, kind])
    # туши: целая, разделанная, остов (и охотники рядом)
    for i, (kind, frac) in enumerate((('deer', 1.0), ('boar', 0.55), ('sheep', 0.2), ('deer', 0.5), ('sheep', 0.9))):
        x, y = (cx + 4 + i * 1.3) * TILE, (cy - 3 + (i % 2) * 1.1) * TILE
        an = Animal(kind, x, y, w)
        an.dead = True
        an.dead_t = w.time - 5
        an.amount = an.amount * frac
        an.face = (1, 0) if i % 2 else (0, 1)
        w.animals.append(an)
        v = Unit('villager', 0, x - 12, y + 10, w)
        w.units.append(v)
        v.cmd_gather(an)
    # пни: вырубаем деревья ближе всего к центру
    trees = sorted((n for n in w.nodes if n.kind == 'tree'), key=lambda n: abs(n.tx - cx) + abs(n.ty - cy))
    for n in trees[:10]:
        w.deplete(n)
    for n in trees[10:14]:
        vx, vy = (n.tx + 0.5) * TILE, (n.ty + 1.5) * TILE
        v = Unit('villager', 0, vx, vy, w)
        w.units.append(v)
        v.cmd_gather(n)
    # бой: лучники, арбалетчики и метатели против врага, мангонель
    foes = []
    tgt = w.place_building('barracks', 1, cx + 9, cy + 6, complete=True)
    if tgt is not None:
        tgt.hp = tgt.max_hp * 0.45          # горит
        foes.append(tgt)
    for i in range(3):
        e = Unit('militia', 1, (cx + 13) * TILE, (cy + 5 + i) * TILE, w)
        foes.append(e)
        w.units.append(e)
    shooters = []
    for i in range(9):
        k = ('archer', 'crossbowman', 'skirmisher')[i % 3]
        u = Unit(k, 0, (cx + 3 + (i % 3) * 0.8) * TILE, (cy + 6 + i // 3) * TILE, w)
        shooters.append(u)
    m = Unit('mangonel', 0, (cx + 2) * TILE, (cy + 9) * TILE, w)
    shooters.append(m)
    w.units += shooters
    for p in w.players:
        p.age = 3
    run(w, 0.3)
    for i, u in enumerate(shooters):
        u.cmd_attack(foes[0] if i % 3 else foes[i % len(foes)])
    t = 0.0
    while t < 6.0 and len(w.projectiles) < 6:      # снимок, когда в воздухе больше всего снарядов
        w.update(0.034)
        w.events.clear()
        t += 0.034
    run(w, 0.3)                                      # снаряды — на середине пути
    print('снарядов в полёте:', len(w.projectiles))
    w.decals.append(['blast', (cx + 8) * TILE, (cy + 8) * TILE, 0, w.time - 0.2])
    reveal(w)
    g.center_on((cx + 1) * TILE, (cy + 3) * TILE)
    save(g, os.path.join(a.out, 'land.png'), (SCREEN_W // 2, TOP_H + VIEW_H // 2))
    pygame.quit()


if __name__ == '__main__':
    main()
