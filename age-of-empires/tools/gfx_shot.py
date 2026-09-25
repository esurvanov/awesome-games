#!/usr/bin/env python3
"""Сцены для сверки графики с AoE II DE (docs/research/04_graphics.md): город с жителями, опушка леса, берег, бой,
холмы, обрывы, мелководье.

  .venv/bin/python tools/gfx_shot.py --out shots/gfx            # 4 снимка + сравнение с эталонами + замеры
  .venv/bin/python tools/gfx_shot.py --scenes town,battle

Для каждой сцены: <сцена>.png (экран игры) и <сцена>_vs.png (слева наш вид мира, справа эталон DE,
уменьшенный так, что клетка — те же 64 px, что у нас: 1920 px DE ≈ 20–21 клетка = 1280 px наши).
Печатает средний цвет и яркость V области мира (эталон DE: V ≈ 0.50–0.61, среднее ≈ (150, 122, 68)).
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

from game.data import TILE, TOP_H, VIEW_H, SCREEN_W  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit  # noqa: E402

REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'shots', 'ref', 'gfx')
REF_OF = {'town': 'de_farms_mills.jpg', 'forest': 'de_forest_town.jpg', 'shore': 'de_shore_naval.jpg',
          'battle': 'de_castle_walls_battle.jpg', 'hills': 'hd_classicart_farms_hills.jpg',
          'cliffs': 'de_farms_mills.jpg', 'shallows': 'de_river_army.jpg'}


def _ref_path(name):
    p = os.path.join(REF, name)
    if not os.path.exists(p):         # рабочее дерево git: эталоны лежат в основной копии
        p = os.path.abspath(os.path.join(REF, '..', '..', '..', '..', '..', '..', 'shots', 'ref', 'gfx', name))
    return p


def _reveal(w):
    w.vis = bytearray(b'\x01' * (w.W * w.H))
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    w.amat[0] = [True] * len(w.amat[0])
    for b in w.buildings:
        b.seen = True
    w.fog_version += 1


def _run(w, sec):
    t = 0.0
    while t < sec and w.winner is None:
        w.update(0.034)
        w.events.clear()
        t += 0.034


def scene_town(g, seed=4):
    """Своя игра под управлением ИИ 6 минут: центр, дома, фермы, жители за работой."""
    random.seed(seed)
    g.new_game(1, 1, False, ai_human=True, map_type='land', civ='franks')
    w = g.world
    _run(w, 360)
    _reveal(w)
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    g.center_on(*tc.center())
    return g


def scene_forest(g, seed=4):
    w = g.world
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    cx, cy = tc.center()
    # ближайший лагерь лесорубов или ближайшее дерево
    lc = [b for b in w.buildings if b.owner == 0 and b.kind == 'lumber_camp']
    if lc:
        b = min(lc, key=lambda b: (b.center()[0] - cx) ** 2 + (b.center()[1] - cy) ** 2)
        g.center_on(*b.center())
    else:
        n = min((n for n in w.nodes if n.kind == 'tree'), key=lambda n: (n.tx * TILE - cx) ** 2 + (n.ty * TILE - cy) ** 2)
        g.center_on(n.tx * TILE, n.ty * TILE)
    return g


def scene_shore(g, seed=5):
    random.seed(seed)
    g.new_game(1, 1, False, ai_human=True, map_type='coast', civ='byzantines')
    w = g.world
    _run(w, 420)
    _reveal(w)
    docks = [b for b in w.buildings if b.kind == 'dock']
    if docks:
        g.center_on(*docks[0].center())
    else:
        tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
        best = None
        for y in range(w.H):
            for x in range(w.W):
                if w.terrain[y][x] == 1:
                    d = (x - tc.tx) ** 2 + (y - tc.ty) ** 2
                    if best is None or d < best[0]:
                        best = (d, x, y)
        g.center_on(best[1] * TILE, best[2] * TILE)
    return g


ARMY_A = ['champion'] * 5 + ['halberdier'] * 4 + ['arbalester'] * 5 + ['paladin'] * 4 + ['monk'] * 2 + \
    ['villager'] * 3 + ['onager', 'trebuchet', 'siege_ram']
ARMY_B = ['two_handed_swordsman'] * 4 + ['elite_skirmisher'] * 4 + ['heavy_cavalry_archer'] * 3 + \
    ['hussar'] * 3 + ['knight'] * 4 + ['hand_cannoneer'] * 4 + ['mangonel', 'capped_ram']


def scene_battle(g, seed=2, seconds=5.0):
    random.seed(seed)
    g.new_game(1, 1, False, civ='franks')
    w = g.world
    w.ais = []
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    cx, cy = tc.tx + 2, tc.ty + 9
    for y in range(cy - 9, cy + 9):
        for x in range(cx - 10, cx + 10):
            if not (0 <= x < w.W and 0 <= y < w.H):
                continue
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]
    for owner, army, side in ((0, ARMY_A, -1), (1, ARMY_B, 1)):
        for i, k in enumerate(army):
            row, col = divmod(i, 7)
            u = Unit(k, owner, (cx + side * (2.5 + row * 1.1)) * TILE, (cy - 3 + col * 1.0) * TILE, w)
            if u.d.get('pack'):
                u.packed = False
            w.units.append(u)
    for p in w.players:
        p.age = 3
    _run(w, seconds)
    _reveal(w)
    g.center_on(cx * TILE, (cy - 3) * TILE)
    return g


def _relief_game(g, seed, map_type='land', players=2, need=None):
    """Партия, где есть нужное (need(w) → точка или None); ИИ играет 3 минуты, туман снят."""
    for k in range(40):
        random.seed(seed + k)
        g.new_game(1, players - 1, False, ai_human=True, map_type=map_type, civ='franks')
        w = g.world
        pt = need(w) if need else None
        if pt is not None or need is None:
            _run(w, 180)
            _reveal(w)
            return w, pt
    return w, None


def scene_hills(g, seed=11):
    """Холмы: самый высокий склон на карте с юнитами на нём (эталон — hd_classicart_farms_hills.jpg)."""
    def need(w):
        best = None
        for y in range(20, w.H - 20):
            for x in range(20, w.W - 20):
                h = w.hz[y][x]
                if best is None or h > best[0]:
                    best = (h, x, y)
        return (best[1], best[2]) if best and best[0] >= 4 * 16 else None
    w, (x, y) = _relief_game(g, seed, need=need)
    for i in range(6):
        tx, ty = w.nearest_free_tile(x + i - 3, y + 2)
        w.units.append(Unit(('militia', 'archer', 'knight')[i % 3], 0, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w))
    g.center_on(x * TILE, y * TILE)
    return g


def scene_cliffs(g, seed=21):
    def need(w):
        if len(w.cliffs) < 6:
            return None
        xs = [c[0] for c in w.cliffs[:6]]
        ys = [c[1] for c in w.cliffs[:6]]
        return sum(xs) / 6, sum(ys) / 6
    w, (x, y) = _relief_game(g, seed, need=need)
    g.center_on(x * TILE, y * TILE)
    return g


def scene_shallows(g, seed=31):
    def need(w):
        sh = [(x, y) for y in range(w.H) for x in range(w.W) if w.terrain[y][x] == 2]
        return sh[len(sh) // 2] if len(sh) > 20 else None
    w, (x, y) = _relief_game(g, seed, map_type='coast', need=need)
    g.center_on(x * TILE, y * TILE)
    return g


def world_stats(surf):
    import numpy as np
    a = pygame.surfarray.array3d(surf.subsurface(pygame.Rect(0, TOP_H, SCREEN_W, VIEW_H))).astype(np.float32)
    m = a.reshape(-1, 3).mean(0)
    v = a.max(2).mean() / 255
    return tuple(int(x) for x in m), round(float(v), 3)


def compare(surf, scene, out):
    """Слева — наш вид мира, справа — эталон DE в том же масштабе клетки."""
    ref = _ref_path(REF_OF[scene])
    view = surf.subsurface(pygame.Rect(0, TOP_H, SCREEN_W, VIEW_H)).copy()
    if not os.path.exists(ref):
        return None
    r = pygame.image.load(ref)
    k = SCREEN_W / r.get_width()
    r = pygame.transform.smoothscale(r, (SCREEN_W, int(r.get_height() * k)))
    rr = r.subsurface(pygame.Rect(0, max(0, (r.get_height() - VIEW_H) // 2), SCREEN_W, min(VIEW_H, r.get_height())))
    sheet = pygame.Surface((SCREEN_W * 2 + 8, VIEW_H))
    sheet.fill((20, 20, 20))
    sheet.blit(view, (0, 0))
    sheet.blit(rr, (SCREEN_W + 8, 0))
    pygame.image.save(sheet, os.path.join(out, f'{scene}_vs.png'))
    return world_stats(r)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default='shots/gfx')
    ap.add_argument('--scenes', default='town,forest,shore,battle,hills,cliffs,shallows')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    g = Game()
    for sc in a.scenes.split(','):
        if sc == 'forest' and 'town' not in a.scenes.split(','):
            scene_town(g)
        {'town': scene_town, 'forest': scene_forest, 'shore': scene_shore, 'battle': scene_battle,
         'hills': scene_hills, 'cliffs': scene_cliffs, 'shallows': scene_shallows}[sc](g)
        g.selected = []
        g.draw()
        pygame.image.save(g.screen, os.path.join(a.out, f'{sc}.png'))
        ours = world_stats(g.screen)
        de = compare(g.screen, sc, a.out)
        print(f'{sc:7s} наш цвет {ours[0]} V {ours[1]}   DE {de[0] if de else "-"} V {de[1] if de else "-"}')
    pygame.quit()


if __name__ == '__main__':
    main()
