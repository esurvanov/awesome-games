#!/usr/bin/env python3
"""Windowless wolf and relic checks (AoE2 DE): a wolf attacks a villager nearby, a militiaman kills a wolf,
a wolf is not game; a monk picks up a relic, drops it off at the monastery (+0.5 gold/s), the monk's death - the relic
is on the ground, the monastery's destruction - the relics fall out; saving/loading with a carried and a deposited relic.

  .venv/bin/python tools/relic_wolf_test.py          # exit code 0 - everything passed
"""
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE  # noqa: E402
from game.world import World, Unit, Animal  # noqa: E402
from game import terrain, relics, orders, savegame  # noqa: E402

DT = 0.034
FAILS = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        FAILS.append(what)


def arena(seed=1):
    random.seed(seed)
    w = World(1, 2)
    w.units.clear()
    w.animals.clear()
    w.ais = []
    cx, cy = w.W // 2, w.H // 2
    for y in range(cy - 14, cy + 14):
        for x in range(cx - 14, cx + 14):
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]
    terrain.flatten(w, 0, 0, w.W, w.H)
    return w, cx, cy


def put(w, kind, owner, tx, ty):
    u = Unit(kind, owner, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w)
    w.units.append(u)
    return u


def run(w, sec, until=None):
    t = 0.0
    while t < sec:
        w.update(DT)
        w.events.clear()
        t += DT
        if until is not None and until():
            return t
    return t


def test_wolf():
    print('wolves')
    w, cx, cy = arena(1)
    wolf = Animal('wolf', (cx + 0.5) * TILE, (cy + 0.5) * TILE, w)
    w.animals.append(wolf)
    v = put(w, 'villager', 0, cx + 4, cy)
    hp0 = v.hp
    run(w, 8, lambda: v.hp < hp0)
    check(v.hp < hp0, f'a wolf attacks a villager 4 tiles away (HP {hp0:g} → {v.hp:g})')
    check(wolf.state == 'attack' and wolf.target is v, 'the wolf attacks the villager')
    # a villager cannot "gather" a wolf
    check(not v.gather_target_valid(wolf), 'a wolf is not game for a villager')
    check(w.find_resource(v, 'hunt', wolf.x, wolf.y, 10) is None, 'the hunt search does not find the wolf')
    # a militiaman nearby attacks the wolf on his own and kills it
    m = put(w, 'militia', 0, cx + 6, cy + 1)
    t = run(w, 30, lambda: wolf.dead)
    check(wolf.dead, f'the militiaman killed the wolf ({t:.1f} s)')
    check(m.alive and v.alive, 'the militiaman and the villager are alive')
    check(wolf.amount == 0, 'a wolf carcass without food')
    run(w, relics_rot() + 1)
    check(wolf not in w.animals, 'the wolf carcass disappears')
    # a wolf does not go far from its den
    w, cx, cy = arena(2)
    wolf = Animal('wolf', (cx + 0.5) * TILE, (cy + 0.5) * TILE, w)
    w.animals.append(wolf)
    s = put(w, 'scout', 0, cx + 5, cy)
    s.cmd_move((cx - 13) * TILE, (cy + 0.5) * TILE)     # a scout leads the wolf away with him? - it walks past
    run(w, 1)
    s.cmd_move((cx + 13) * TILE, (cy + 0.5) * TILE)
    run(w, 25)
    dd = ((wolf.x - wolf.den[0]) ** 2 + (wolf.y - wolf.den[1]) ** 2) ** 0.5 / TILE
    check(dd <= Animal.LEASH + 2, f'the wolf stays near the den ({dd:.1f} tiles)')


def relics_rot():
    return Animal.WOLF_ROT


def mk_monastery(w, pid, tx, ty):
    return w.place_building('monastery', pid, tx, ty, complete=True)


def test_relic():
    print('relics')
    w, cx, cy = arena(3)
    b = mk_monastery(w, 0, cx - 8, cy - 1)
    r = relics.spawn(w, cx + 6, cy)
    check(r in w.relics and r.free, 'a relic on the ground')
    m = put(w, 'monk', 0, cx, cy)
    check(orders.issue(m, w, ('relic', r)), 'the "pick up a relic" order')
    run(w, 30, lambda: m.relic is r)
    check(m.relic is r and r.carrier is m, 'the monk carries a relic')
    e = put(w, 'militia', 1, cx + 3, cy + 3)
    m.cmd_attack(e)
    check(m.state != 'convert', 'with a relic the monk does not convert')
    e.alive = False
    w.units.remove(e)
    # saving with a carried relic
    w2 = savegame.loads(savegame.dumps(w))
    m2 = next(u for u in w2.units if u.kind == 'monk')
    check(m2.relic is not None and m2.relic.carrier is m2 and m2.relic in w2.relics,
          'loading: the relic is with the monk')
    g0 = w.players[0].res['gold']
    check(orders.issue(m, w, ('relic_in', b)), 'the "to the monastery" order')
    run(w, 40, lambda: r.holder is b)
    check(r.holder is b and m.relic is None, 'the relic is in the monastery')
    check(relics.held(w, b) == 1, 'there is 1 relic in the monastery')
    g1 = w.players[0].res['gold']
    run(w, 10)
    g2 = w.players[0].res['gold']
    rate = (g2 - g1) / 10
    check(abs(rate - 0.5) < 0.03, f'income {rate:.3f} gold/s (~0.5)')
    check(g1 >= g0, 'gold does not decrease')
    # saving with a deposited relic
    w3 = savegame.loads(savegame.dumps(w))
    b3 = next(x for x in w3.buildings if x.kind == 'monastery')
    check(relics.held(w3, b3) == 1, 'loading: the relic is in the monastery')
    ga = w3.players[0].res['gold']
    run(w3, 4)
    check(w3.players[0].res['gold'] - ga > 1.8, 'loading: income goes')
    # a monk dies with a relic - the relic is on the ground
    r2 = relics.spawn(w, cx + 2, cy + 4)
    orders.issue(m, w, ('relic', r2))
    run(w, 30, lambda: m.relic is r2)
    check(m.relic is r2, 'the monk picked up a second relic')
    w.damage(m, put(w, 'militia', 1, cx - 12, cy - 12), 999)
    run(w, 0.5)
    check(r2.free and r2.carrier is None, 'the monk died - the relic is on the ground')
    check(abs(r2.x - m.x) < 2 * TILE and abs(r2.y - m.y) < 2 * TILE, 'the relic is where the monk died')
    # the monastery is destroyed - the relics fall out
    w.remove_building(b)
    run(w, 0.5)
    check(r.free and relics.held(w, b) == 0, 'the monastery is destroyed - the relic fell out')
    check(w.passable(r.tx, r.ty), 'it fell onto a passable tile')


def test_ai():
    print('the AI and relics')
    from game.ai import AI
    w, cx, cy = arena(4)
    b = mk_monastery(w, 1, cx - 8, cy - 1)
    put(w, 'monk', 1, cx, cy)
    put(w, 'villager', 1, cx - 2, cy + 4)
    r = relics.spawn(w, cx + 7, cy + 2)
    ai = AI(w, 1, 1, level=3)
    w.ais = [ai]
    run(w, 90, lambda: r.holder is b)
    check(r.holder is b, 'the AI\'s monk brought a relic to the monastery')


def main():
    test_wolf()
    test_relic()
    test_ai()
    print('TOTAL:', 'all passed' if not FAILS else f'{len(FAILS)} failures')
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
