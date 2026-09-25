#!/usr/bin/env python3
"""Безоконные проверки рельефа (game/terrain.py): высота и урон ±25 %, обрывы (непроходимы, карта связна),
мелководье (пешие ходят, корабли — нет, строить нельзя), здания на склонах, выбор мышью на высоте,
сохранение рельефа, время сборки земли.

  .venv/bin/python tools/terrain_test.py          # код выхода 0 — всё прошло
"""
import math
import os
import random
import sys
import time

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE  # noqa: E402
from game.world import World, Unit  # noqa: E402
from game import terrain, naval, savegame  # noqa: E402

FAILS = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        FAILS.append(what)


def clear(w, x0, y0, x1, y1):
    for y in range(y0, y1):
        for x in range(x0, x1):
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]


def arena(seed=1):
    random.seed(seed)
    w = World(1, 2)
    w.units.clear()
    w.animals.clear()
    w.ais = []
    cx, cy = w.W // 2, w.H // 2
    clear(w, cx - 12, cy - 12, cx + 12, cy + 12)
    return w, cx, cy


def test_height_damage():
    print('Высота и урон')
    w, cx, cy = arena()
    # холм: на востоке арены уровень 3 (ровная площадка), на западе — 0; между — склон
    terrain.set_heights(w, lambda x, y: 3.0 if x >= cx + 2 else 0.0 if x <= cx - 2 else (x - cx + 2) * 0.75)
    check(w.relief, 'рельеф включён')
    hi = Unit('archer', 0, (cx + 5.5) * TILE, (cy + 0.5) * TILE, w)
    lo = Unit('spearman', 1, (cx - 4.5) * TILE, (cy + 0.5) * TILE, w)
    lo2 = Unit('archer', 1, (cx - 5.5) * TILE, (cy + 0.5) * TILE, w)
    w.units += [hi, lo, lo2]
    check(w.elev(cx + 5, cy) == 3 and w.elev(cx - 5, cy) == 0, f'уровни клеток 3 и 0 ({w.elev(cx + 5, cy)}, '
                                                               f'{w.elev(cx - 5, cy)})')
    check(abs(w.z_at(hi.x, hi.y) - 3 * terrain.ZL) < 1e-6, f'высота под юнитом = 3·{terrain.ZL} px')
    base_rel = w.relief
    w.relief = False
    flat_down = w.calc_damage(hi, lo, True)
    flat_up = w.calc_damage(lo2, hi, True)
    w.relief = base_rel
    down = w.calc_damage(hi, lo, True)
    up = w.calc_damage(lo2, hi, True)
    check(abs(down - flat_down * 1.25) < 1e-6, f'сверху вниз ×1.25: {flat_down} → {down}')
    check(abs(up - flat_up * 0.75) < 1e-6, f'снизу вверх ×0.75: {flat_up} → {up}')
    same = Unit('archer', 1, (cx + 6.5) * TILE, (cy + 1.5) * TILE, w)
    w.relief = False
    fs = w.calc_damage(hi, same, True)
    w.relief = True
    check(w.calc_damage(hi, same, True) == fs, 'на одной высоте — без изменений')
    # и вживую: лучник на холме убивает быстрее, чем снизу
    terrain.flatten(w, 0, 0, w.W, w.H)
    check(not w.relief and w.z_at(hi.x, hi.y) == 0, 'flatten: ровно')


def test_cliffs():
    print('Обрывы')
    seen = 0
    for seed in range(12):
        random.seed(seed)
        w = World(1, 4 if seed % 2 else 2, map_type='land' if seed % 3 else 'coast')
        if not w.cliffs:
            continue
        seen += 1
        cells = {(x, y) for x, y, _ in w.cliffs}
        ok = all(w.terrain[y][x] == terrain.CLIFF and not w.passable(x, y) for x, y in cells)
        # связность: обрывы не отрезают ни клетки проходимой суши (сравнение с картой без них)
        W, H = w.W, w.H
        walk = [not w.terrain[i // W][i % W] & 1 and w.occ[i // W][i % W] is None for i in range(W * H)]
        _, n1 = terrain._labels(W, H, walk)
        walk2 = list(walk)
        for x, y in cells:
            walk2[y * W + x] = w.occ[y][x] is None
        _, n0 = terrain._labels(W, H, walk2)
        # путь от старта к старту — не через обрыв
        (ax, ay), (bx, by) = w.starts[0], w.starts[1]
        a = w.nearest_free_tile(ax + 3, ay + 3)
        b = w.nearest_free_tile(bx + 3, by + 3)
        p = w.find_path(a, [b], b[0], b[1], limit=40000)
        through = any(c in cells for c in p)
        # дальние от стартов
        far = all(min(math.hypot(x - sx, y - sy) for sx, sy in w.starts) >= 15 for x, y in cells)
        if not (ok and n1 <= n0 and w.path_reached and not through and far):
            check(False, f'сид {seed}: непроходимы {ok}, компоненты {n0}→{n1}, путь {w.path_reached}, '
                         f'через обрыв {through}, далеко от стартов {far}')
            return
    check(seen >= 4, f'обрывы есть на {seen} из 12 карт; непроходимы, карта не делится, пути в обход')
    # поиск пути обходит стену обрыва
    w, cx, cy = arena(3)
    for y in range(cy - 5, cy + 6):
        w.terrain[y][cx] = terrain.CLIFF
    p = w.find_path((cx - 3, cy), [(cx + 3, cy)], cx + 3, cy)
    check(w.path_reached and all(w.terrain[y][x] != terrain.CLIFF for x, y in p) and len(p) > 7,
          f'путь в обход стены обрыва ({len(p)} шагов)')


def test_shallows():
    print('Мелководье')
    found = None
    for seed in range(10):
        random.seed(seed)
        w = World(1, 2, map_type=('land', 'coast', 'islands')[seed % 3])
        sh = [(x, y) for y in range(w.H) for x in range(w.W) if w.terrain[y][x] == terrain.SHALLOW]
        if sh:
            found = (w, sh)
            break
    check(found is not None, 'мелководье есть на картах')
    if not found:
        return
    w, sh = found
    x, y = sh[0]
    check(w.passable(x, y), 'пешим проходимо')
    check(not naval.water_ok(w, x, y), 'кораблям — нет')
    check(not w.can_place('house', x, y, 0, check_explored=False), 'дом на мелководье не ставится')
    check(all(w.ground[yy * w.W + xx] == terrain.G['shallow'] for xx, yy in sh), 'тип земли — мелководье')
    # брод: поперёк реки из мелководья проходят пешие
    w, cx, cy = arena(4)
    for yy in range(cy - 8, cy + 9):
        for xx in range(cx - 1, cx + 2):
            w.terrain[yy][xx] = terrain.WATER
    w.terrain[cy][cx - 1] = w.terrain[cy][cx] = w.terrain[cy][cx + 1] = terrain.SHALLOW
    w._naval_comps = None
    p = w.find_path((cx - 4, cy + 2), [(cx + 4, cy + 2)], cx + 4, cy + 2)
    check(w.path_reached and (cx, cy) in p, f'путь через брод ({len(p)} шагов)')
    u = Unit('militia', 0, (cx - 4 + 0.5) * TILE, (cy + 2.5) * TILE, w)
    w.units.append(u)
    u.cmd_move((cx + 4.5) * TILE, (cy + 2.5) * TILE)
    t = 0
    while t < 30 and u.state == 'move':
        w.update(0.05)
        w.events.clear()
        t += 0.05
    check(int(u.x // TILE) == cx + 4, f'ополченец перешёл брод ({u.x / TILE:.1f}, {u.y / TILE:.1f})')


def test_building_slope():
    print('Здания на склонах')
    w, cx, cy = arena(5)
    terrain.set_heights(w, lambda x, y: max(0.0, min(4.0, (x - cx) * 0.9)))       # склон 0.9 уровня/клетку
    check(w.can_place('house', cx - 6, cy, 0, check_explored=False), 'ровно — можно')
    check(not w.can_place('town_center', cx + 1, cy, 0, check_explored=False), 'ЦГ на крутом склоне — нельзя')
    check(w.can_place('house', cx, cy, 0, check_explored=False) == (terrain.footprint_range(w, cx, cy, 2, 2)[1] -
                                                                   terrain.footprint_range(w, cx, cy, 2, 2)[0] <= 1),
          'дом: перепад ≤ 1 уровня — можно')
    lo, hi = terrain.footprint_range(w, cx + 1, cy, 2, 2)
    check(hi - lo > 1 and not w.can_place('house', cx + 1, cy, 0, check_explored=False),
          f'дом на перепаде {hi - lo:.1f} уровня — нельзя')
    terrain.set_heights(w, lambda x, y: 2.0)
    check(w.can_place('town_center', cx - 2, cy - 2, 0, check_explored=False), 'ровное плато — можно')


def test_picking():
    print('Выбор мышью на высоте')
    from game.ui import Game
    g = Game()
    random.seed(6)
    g.new_game(1, 1, False, map_type='land')
    w = g.world
    w.explored[:] = b'\x01' * len(w.explored)
    w.vis[:] = b'\x01' * len(w.vis)
    cx, cy = w.W // 2, w.H // 2
    clear(w, cx - 6, cy - 6, cx + 6, cy + 6)
    terrain.set_heights(w, lambda x, y: max(0.0, 4.0 - 0.6 * math.hypot(x - cx, y - cy)))
    g.build_terrain()
    u = Unit('militia', 0, (cx + 0.5) * TILE, (cy + 0.5) * TILE, w)
    w.units.append(u)
    g.center_on(u.x, u.y)
    for zoom in (1.0, 1.4, 0.7):
        g.set_zoom(zoom)
        g.center_on(u.x, u.y)
        g.draw()
        sx, sy = g.w2s(u.x, u.y)
        wx, wy = g.s2w(sx, sy)
        check(math.hypot(wx - u.x, wy - u.y) < 1.5, f'×{zoom}: экран → мир на вершине холма ({wx - u.x:+.2f}, '
                                                    f'{wy - u.y:+.2f})')
        flat = (sx, sy + w.z_at(u.x, u.y) * zoom)       # куда юнит попал бы без высоты
        check(g.entity_at((sx, sy - 10 * zoom)) is u, f'×{zoom}: щелчок по юниту на высоте {w.z_at(u.x, u.y):.0f} px')
        check(g.entity_at(flat) is not u, f'×{zoom}: по «плоскому» месту — не он')
    g.set_zoom(1.0)
    # здание: основание на средней высоте
    tx, ty = cx + 3, cy - 1
    clear(w, tx, ty, tx + 2, ty + 2)
    b = w.place_building('house', 0, tx, ty, complete=True)
    z = terrain.building_z(w, b)
    check(abs(g.b2s(b)[1] - (g.w2s(tx * TILE, ty * TILE, 0)[1] - z)) < 1e-6, f'дом на высоте {z:.1f} px')
    # размещение: клетка под курсором на холме
    g.placing = 'house'
    px, py = g.w2s((cx + 1) * TILE, (cy + 1) * TILE)
    check(g.place_tile((px, py)) == (cx, cy), f'закладка под курсором на холме {g.place_tile((px, py))}')
    g.placing = None


def test_save():
    print('Сохранение рельефа')
    random.seed(7)
    w = World(1, 2, map_type='coast')
    w2 = savegame.loads(savegame.dumps(w))
    check(w2.hz == w.hz and w2.elev_map == w.elev_map and w2.ground == w.ground and w2.cliffs == w.cliffs and
          w2.terrain == w.terrain and w2.relief == w.relief, 'высоты, уровни, типы земли, обрывы, мелководье')
    # старое сохранение без рельефа — плоско
    d = dict(w.__dict__)
    for k in ('hz', 'elev_map', 'ground', 'cliffs', 'relief'):
        d.pop(k, None)
    w3 = World.__new__(World)
    w3.__setstate__(d)
    check(not w3.relief and w3.z_at(100, 100) == 0 and len(w3.ground) == w.W * w.H, 'старое сохранение — ровная земля')


def test_build_time():
    print('Сборка земли и кадр')
    from game.ui import Game
    g = Game()
    for n, mt in ((4, 'land'), (4, 'coast')):
        random.seed(8)
        g.new_game(1, n - 1, False, map_type=mt)
        t = time.time()
        g.build_terrain()
        dt = time.time() - t
        check(dt < 3.0, f'{mt} {g.world.W}×{g.world.H}: земля за {dt:.2f} с (≤ 3)')


def main():
    test_height_damage()
    test_cliffs()
    test_shallows()
    test_building_slope()
    test_picking()
    test_save()
    test_build_time()
    print(f'=== провалов: {len(FAILS)}')
    for f in FAILS:
        print('  -', f)
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
