#!/usr/bin/env python3
"""Windowless water and fleet checks (no AI): .venv/bin/python tools/test_naval.py
A dock at the shore, a fishing ship, fishing by a villager from the shore, a galley fight, boarding/unloading, passengers' death,
islands (each has its own land). A nonzero exit code if something is wrong."""
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE  # noqa: E402
from game.world import World, Unit  # noqa: E402
from game import naval  # noqa: E402

DT = 0.034
FAILS = []


def check(cond, name, info=''):
    print(('ok   ' if cond else 'FAIL ') + name + (f'  ({info})' if info else ''))
    if not cond:
        FAILS.append(name)


def run(w, secs, until=None):
    end = w.time + secs
    while w.time < end:
        w.update(DT)
        w.events.clear()
        if until is not None and until():
            return True
    return until() if until else True


def world(mt='coast', seed=3, n=2):
    random.seed(seed)
    w = World(1, n, None, map_type=mt)
    w.ais = []
    return w


def dock_spot(w, pid):
    """A dock spot closest to the player's start."""
    sx, sy = w.starts[pid]
    best = None
    for y in range(w.H):
        for x in range(w.W):
            if w.terrain[y][x] == 1 and abs(x - sx) + abs(y - sy) < 40 and w.can_place('dock', x, y, pid, False):
                d = abs(x - sx) + abs(y - sy)
                if best is None or d < best[0]:
                    best = (d, x, y)
    return best[1], best[2]


def main():
    # ---- 1. the dock placement rule
    w = world()
    tx, ty = dock_spot(w, 0)
    check(w.can_place('dock', tx, ty, 0, False), 'dock: at the shore is allowed')
    sx, sy = w.starts[0]
    check(not w.can_place('dock', sx + 3, sy + 3, 0, False), 'dock: on land is not allowed')
    deep = next((x, y) for y in range(w.H) for x in range(w.W)
                if all(0 <= x + dx < w.W and 0 <= y + dy < w.H and w.terrain[y + dy][x + dx] == 1
                       for dx in range(-1, 5) for dy in range(-1, 5)))
    check(not w.can_place('dock', deep[0], deep[1], 0, False), 'dock: in the open sea is not allowed', str(deep))
    check(not w.can_place('house', tx, ty, 0, False), 'a house on water is not allowed')

    # ---- 2. a fishing ship catches and delivers to the dock
    dock = w.place_building('dock', 0, tx, ty, complete=True)
    p = w.players[0]
    food0 = p.res['food']
    fs = w.spawn(dock, 'fishing_ship')
    check(fs.naval and naval.water_ok(w, *fs.tile()), 'the ship appeared on water', str(fs.tile()))
    fish = naval.find_fish(w, fs, fs.x, fs.y, 60)
    check(fish is not None, 'fish within reach')
    fs.cmd_gather(fish)
    ok = run(w, 240, lambda: p.gathered['food'] >= 30)
    check(ok and p.res['food'] > food0, 'the fishing ship delivered the catch to the dock',
          f"collected {p.gathered['food']:.0f}, state {fs.state}")
    check(all(w.terrain[int(u.y // TILE)][int(u.x // TILE)] == 1 for u in w.units if u.naval), 'ships only on water')

    # ---- 3. a villager fishes from the shore
    w = world(seed=5)
    p = w.players[0]
    sx, sy = w.starts[0]
    shore = [n for n in w.nodes if n.kind == 'shore_fish' and w.exposed(n)]
    n = min(shore, key=lambda n: math.hypot(n.tx - sx, n.ty - sy))
    lx, ly = w.nearest_free_tile(n.tx, n.ty)
    v = Unit('villager', 0, (lx + 0.5) * TILE, (ly + 0.5) * TILE, w)
    w.units.append(v)
    v.cmd_gather(n)
    a0 = n.amount
    ok = run(w, 200, lambda: p.gathered['food'] >= 10)
    rate = (a0 - n.amount) / max(1e-6, w.time)
    check(ok, 'the villager brought fish from the shore', f'{p.gathered["food"]:.0f} food, {v.state}')
    check(a0 > n.amount, 'the fish decreased', f'{a0} → {n.amount:.0f}, on average {rate:.2f}/s including the road')

    # ---- 4. a galley sinks a fishing ship
    w = world(seed=7)
    tx, ty = dock_spot(w, 0)
    d0 = w.place_building('dock', 0, tx, ty, complete=True)
    w.players[0].age = 1
    gal = w.spawn(d0, 'galley')
    fs = naval.Ship('fishing_ship', 1, gal.x, gal.y, w)
    wx, wy = naval.nearest_water_tile(w, int(gal.x // TILE) + 4, int(gal.y // TILE) + 4, free=True)
    fs.x, fs.y = (wx + 0.5) * TILE, (wy + 0.5) * TILE
    w.units.append(fs)
    gal.cmd_attack(fs)
    ok = run(w, 120, lambda: not fs.alive)
    check(ok, 'the galley sank the fishing ship', f'{w.time:.0f} s, target HP {fs.hp:.0f}')
    # idle: the galley itself attacks an enemy nearby
    fs2 = naval.Ship('fishing_ship', 1, gal.x, gal.y, w)
    wx, wy = naval.nearest_water_tile(w, int(gal.x // TILE) - 3, int(gal.y // TILE) + 3, free=True)
    fs2.x, fs2.y = (wx + 0.5) * TILE, (wy + 0.5) * TILE
    w.units.append(fs2)
    gal.stop()
    ok = run(w, 90, lambda: not fs2.alive)
    check(ok, 'the galley found a target itself')

    # ---- 5. transport: boarding and unloading on the other shore; passengers' death
    w = world(seed=9)
    tx, ty = dock_spot(w, 0)
    d0 = w.place_building('dock', 0, tx, ty, complete=True)
    tr = w.spawn(d0, 'transport_ship')
    sx, sy = w.starts[0]
    squad = []
    for i in range(3):
        fx, fy = w.nearest_free_tile(tx - 2 + i, ty - 2)
        u = Unit('militia', 0, (fx + 0.5) * TILE, (fy + 0.5) * TILE, w)
        w.units.append(u)
        squad.append(u)
    check(naval.order_board(w, squad, tr), 'the boarding order was accepted')
    ok = run(w, 90, lambda: len(tr.cargo) == 3)
    check(ok, 'three boarded the transport', f'in the hold {len(tr.cargo)}')
    check(all(u not in w.units for u in squad), 'no passengers on the map')
    check(w.players[0].pop == sum(1 for u in w.units if u.owner == 0) + 3, 'passengers count in the population')
    ex, ey = w.starts[1]
    tr.cmd_unload(ex * TILE, ey * TILE)
    ok = run(w, 240, lambda: not tr.cargo)
    land = [u for u in squad if u.alive and u in w.units and w.terrain[int(u.y // TILE)][int(u.x // TILE)] == 0]
    near = min((math.hypot(u.x / TILE - ex, u.y / TILE - ey) for u in land), default=999)
    check(ok and len(land) == 3, 'unloading onto the shore', f'on land {len(land)}, to the target {near:.0f} cells')
    check(math.hypot(tr.x / TILE - sx, tr.y / TILE - sy) > math.hypot(tr.x / TILE - ex, tr.y / TILE - ey),
          'the transport sailed to the enemy')
    # death
    naval.order_board(w, land, tr)
    run(w, 60, lambda: len(tr.cargo) == 3)
    inside = list(tr.cargo)
    w.damage(tr, tr, 999)
    check(inside and all(not u.alive for u in inside) and not tr.cargo, 'the transport sank - the passengers died',
          f'was {len(inside)}')

    # ---- 6. islands: each has its own land, a strait between them
    w = world('islands', seed=4, n=3)
    ls = [naval.land_comp(w, *s) for s in w.starts]
    check(len(set(ls)) == 3, 'islands: three different islands', str(ls))
    for mt in ('coast', 'islands'):
        for n in (2, 3, 4):
            w = world(mt, seed=n, n=n)
            cnt = [sum(1 for f in w.nodes if f.kind in naval.FISH and
                       math.hypot(f.tx - sx, f.ty - sy) < 32) for sx, sy in w.starts]
            check(min(cnt) >= 6, f'{mt} on {n}: fish at each', str(cnt))

    # ---- 7. interface: right click - boarding, unloading, fishing; the "unload" button
    os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
    from game.ui import Game
    random.seed(11)
    g = Game()
    g.new_game(1, 1, map_type='coast')
    w = g.world
    w.ais = []
    tx, ty = dock_spot(w, 0)
    d0 = w.place_building('dock', 0, tx, ty, complete=True)
    tr = w.spawn(d0, 'transport_ship')
    fs = w.spawn(d0, 'fishing_ship')
    squad = []
    for i in range(2):
        fx, fy = w.nearest_free_tile(tx - 2 + i, ty - 2)
        u = Unit('spearman', 0, (fx + 0.5) * TILE, (fy + 0.5) * TILE, w)
        w.units.append(u)
        squad.append(u)
    g.selected = list(squad)
    g.command(tr.x, tr.y, tr)
    check(set(tr.to_load) == set(squad), 'right click on a transport - boarding')
    run(w, 60, lambda: len(tr.cargo) == 2)
    g.update(0.01)
    check(len(tr.cargo) == 2 and not g.selected, 'boarded; gone from the selection')
    g.selected = [tr]
    acts = [b['act'][0] for b in g.get_buttons()]
    check('unload' in acts, 'the "unload" button', str(acts))
    ex, ey = w.starts[1]
    g.command(ex * TILE, ey * TILE, None)
    check(tr.state == 'unload', 'right click on land - sail to unload')
    fish = naval.find_fish(w, fs, fs.x, fs.y, 60)
    g.selected = [fs]
    g.command(*fish.center(), fish)
    check(fs.state == 'gather' and fs.target is fish, 'right click with a fisher on fish - catch')
    run(w, 200, lambda: not tr.cargo)
    check(not tr.cargo and all(u.alive for u in squad), 'unloaded via the interface')
    g.draw()        # drawing with ships, fish and water does not crash

    print('RESULT:', 'all good' if not FAILS else f'errors {len(FAILS)}: {FAILS}')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
