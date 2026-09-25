#!/usr/bin/env python3
"""Безоконные проверки обороны: стены (протяжка, стройка), ворота (проходимость по владельцу),
пролом стен, гарнизон (стрелы, лечение, высадка при разрушении), набат, превращение башен.

  .venv/bin/python tools/test_defense.py
Выход с ненулевым кодом, если что-то не сошлось.
"""
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from game.data import TILE  # noqa: E402
from game.world import World, Unit  # noqa: E402
from game import defense  # noqa: E402

FAILS = []


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        FAILS.append(what)


def clear_world(seed=1):
    """Мир 2 игроков, без ИИ, всё разведано; вокруг центра игрока 0 расчищено 16 клеток."""
    random.seed(seed)
    w = World(1, 2)
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    for n in w.nodes:
        if abs(n.tx - tc.tx) < 18 and abs(n.ty - tc.ty) < 18:
            w.deplete(n)
    w.nodes = [n for n in w.nodes if n.alive]
    for y in range(max(0, tc.ty - 18), min(w.H, tc.ty + 18)):
        for x in range(max(0, tc.tx - 18), min(w.W, tc.tx + 18)):
            w.terrain[y][x] = 0
    w.animals = [a for a in w.animals if abs(a.x / TILE - tc.tx) > 18 or abs(a.y / TILE - tc.ty) > 18]
    for p in w.players:
        p.res = {'food': 5000, 'wood': 5000, 'gold': 5000, 'stone': 5000}
    return w, tc


def run(w, secs, until=None):
    t = 0.0
    while t < secs:
        w.update(0.034)
        w.events.clear()
        t += 0.034
        if until is not None and until():
            return True
    return until() if until else True


def vil(w, pid, x, y):
    u = Unit('villager', pid, (x + 0.5) * TILE, (y + 0.5) * TILE, w)
    w.units.append(u)
    return u


def test_wall_line():
    print('протяжка стены и стройка')
    w, tc = clear_world()
    p = w.players[0]
    wood0 = p.res['wood']
    y = tc.ty - 5
    vs = [u for u in w.units if u.owner == 0 and u.kind == 'villager']
    segs = defense.place_wall_line(w, 'palisade_wall', 0, tc.tx - 4, y, tc.tx + 7, y, vs)
    check(len(segs) == 12, f'12 сегментов частокола по линии (есть {len(segs)})')
    check(wood0 - p.res['wood'] == 12 * 2, f'цена 2 дерева за сегмент (списано {wood0 - p.res["wood"]})')
    check(all(not s.complete for s in segs), 'все — фундаменты')
    check(all(w.occ[s.ty][s.tx] is s for s in segs), 'фундаменты заняли клетки')
    diag = defense.line_tiles(0, 0, 5, 5)
    check(diag == [(i, i) for i in range(6)], 'диагональная линия — 6 клеток')
    # линия через занятую клетку пропускает её
    tiles = defense.line_tiles(tc.tx - 2, tc.ty + 1, tc.tx + 6, tc.ty + 1)
    plan = defense.wall_plan(w, 'palisade_wall', 0, tiles)
    check(len(plan) == len(tiles) - 4, 'клетки под центром пропущены')
    done = run(w, 240, lambda: all(s.complete for s in segs))
    check(done, 'жители достроили все сегменты (по цепочке)')
    run(w, 1)
    check(all(u.state != 'build' for u in vs), 'строители освободились')
    # каменная стена — только с феодальной эпохи в меню, но логика та же: 5 камня за сегмент
    st0 = p.res['stone']
    segs2 = defense.place_wall_line(w, 'stone_wall', 0, tc.tx - 4, y - 2, tc.tx - 1, y - 2)
    check(len(segs2) == 4 and st0 - p.res['stone'] == 20, 'каменная стена: 5 камня за сегмент')
    check(segs2[0].max_hp == 1800, 'каменная стена 1800 ОЗ')


def box_walls(w, pid, x0, y0, x1, y1, kind='stone_wall'):
    segs = []
    for (a, b) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
        for (x, y) in defense.line_tiles(*a, *b):
            if w.occ[y][x] is None:
                segs.append(w.place_building(kind, pid, x, y, complete=True))
    return segs


def test_gate():
    print('ворота: свои проходят, враги — нет')
    w, tc = clear_world()
    x0, y0 = tc.tx - 8, tc.ty - 8
    x1, y1 = tc.tx + 11, tc.ty + 11
    box_walls(w, 0, x0, y0, x1, y1)
    inside = (tc.tx - 3, tc.ty)
    outside = (x0 - 3, tc.ty)
    p0 = w.find_path(outside, [inside], *inside, limit=20000, owner=0)
    check(not w.path_reached, 'без ворот своим тоже не пройти')
    # ворота поверх стены на левой стороне
    gx, gy = x0, tc.ty - 1
    check(defense.can_place_gate(w, 'gate', gx, gy, False, 0), 'ворота можно поставить поверх своей стены')
    check(not defense.can_place_gate(w, 'gate', gx, gy, False, 1), 'на чужую стену — нельзя')
    stone0 = w.players[0].res['stone']
    g = defense.place_gate(w, 'gate', 0, gx, gy, False)
    check(g is not None and (g.w, g.h) == (1, 4), 'ворота 1×4 заложены')
    check(stone0 - w.players[0].res['stone'] == 30, 'ворота стоят 30 камня')
    check(all(w.occ[y][gx] is g for y in range(gy, gy + 4)), 'сегменты стены заменены воротами')
    w.find_path(outside, [inside], *inside, limit=20000, owner=0)
    check(not w.path_reached, 'недостроенные ворота закрыты')
    g.progress = 1.0
    g.hp = g.max_hp
    p0 = w.find_path(outside, [inside], *inside, limit=20000, owner=0)
    check(w.path_reached and any(w.occ[y][x] is g for x, y in p0), 'свой путь идёт через ворота')
    w.find_path(outside, [inside], *inside, limit=20000, owner=1)
    check(not w.path_reached, 'враг через ворота не проходит')
    check(w.passable_for(gx, gy, 0) and not w.passable_for(gx, gy, 1) and not w.passable(gx, gy),
          'passable_for: свой да, враг нет')
    # настоящие юниты
    friend = vil(w, 0, *outside)
    friend.cmd_move((inside[0] + 0.5) * TILE, (inside[1] + 0.5) * TILE)
    enemy = Unit('militia', 1, (outside[0] + 0.5) * TILE, (outside[1] + 1.5) * TILE, w)
    w.units.append(enemy)
    enemy.cmd_move((inside[0] + 0.5) * TILE, (inside[1] + 0.5) * TILE)
    run(w, 40)
    check(x0 < friend.x / TILE < x1 and y0 < friend.y / TILE < y1, 'свой житель прошёл внутрь')
    check(not (x0 < enemy.x / TILE < x1 and y0 < enemy.y / TILE < y1), 'вражеский ополченец остался снаружи')
    check(defense.gate_open(w, g) in (True, False), 'gate_open работает')
    # союзник проходит
    w2, tc2 = clear_world()
    w2.players[1].team = 0
    w2.update_teams()
    box_walls(w2, 0, x0, y0, x1, y1)
    g2 = defense.place_gate(w2, 'gate', 0, gx, gy, False)
    g2.progress = 1.0
    w2.find_path(outside, [inside], *inside, limit=20000, owner=1)
    check(w2.path_reached, 'союзник проходит через ворота')


def test_breach():
    print('враг, запертый стенами, ломает стену')
    w, tc = clear_world()
    x0, y0, x1, y1 = tc.tx - 5, tc.ty - 5, tc.tx + 8, tc.ty + 8
    segs = box_walls(w, 0, x0, y0, x1, y1, 'palisade_wall')
    army = []
    for i in range(4):
        m = Unit('militia', 1, (x0 - 4 + 0.5) * TILE, (tc.ty + i + 0.5) * TILE, w)
        m.hp = m.max_hp = 10000      # чтобы стрелы центра не мешали проверке
        w.units.append(m)
        m.cmd_attack(tc)
        army.append(m)
    run(w, 40)
    walled = [m for m in army if defense.is_wall(m.target)]
    check(len(walled) >= 3, f'ополченцы переключились на стену ({len(walled)} из 4)')
    hp_lost = sum(s.max_hp - s.hp for s in segs if s.alive) + sum(s.max_hp for s in segs if not s.alive)
    check(hp_lost > 0, 'стена получает урон')
    broke = run(w, 200, lambda: any(not s.alive for s in segs))
    check(broke, 'пролом в стене сделан')
    ok = run(w, 120, lambda: tc.hp < tc.max_hp)
    check(ok, 'после пролома атакуют центр')


def test_garrison():
    print('гарнизон: стрелы, лечение, высадка')
    w, tc = clear_world()
    vs = [vil(w, 0, tc.tx + 5 + i % 3, tc.ty + 5 + i // 3) for i in range(5)]
    enemy = Unit('knight', 1, (tc.tx - 3) * TILE, (tc.ty + 1) * TILE, w)
    enemy.hp = enemy.max_hp = 100000
    w.units.append(enemy)

    def volley():
        tc.cool = 0
        tc.target = None
        n0 = len(w.projectiles)
        tc.update(w, 0.01)
        return len(w.projectiles) - n0
    check(volley() == 1, 'центр без гарнизона: 1 стрела')
    for v in vs:
        v.cmd_garrison(tc)
    w.recount()
    pop0 = w.players[0].pop
    ok = run(w, 30, lambda: len(tc.garrison) == 5)
    check(ok, '5 жителей сели в центр')
    check(all(not v.alive and v.inside is tc for v in vs) and all(v not in w.units for v in vs),
          'сидящие исчезли с карты')
    w.recount()
    check(w.players[0].pop == pop0, 'население не изменилось')
    check(volley() == 6, 'центр с 5 жителями: 6 стрел')
    vs[0].hp = 5
    run(w, 10)
    check(vs[0].hp > 8, 'внутри лечатся')
    # враг не видит сидящих
    check(w.nearest_enemy(enemy, 30 * TILE, buildings=False) not in vs, 'враг не целится в сидящих')
    out = defense.eject(w, tc, [vs[0]])
    check(out == [vs[0]] and vs[0].alive and vs[0] in w.units and len(tc.garrison) == 4, 'выпустить одного')
    # башня разрушена — все выходят
    tw = w.place_building('tower', 0, tc.tx + 7, tc.ty - 4, complete=True)
    arch = []
    for i in range(3):
        a = Unit('archer', 0, (tc.tx + 7.5) * TILE, (tc.ty - 2.5 + i * 0.3) * TILE, w)
        w.units.append(a)
        a.cmd_garrison(tw)
        arch.append(a)
    ok = run(w, 15, lambda: len(tw.garrison) == 3)
    check(ok, '3 лучника в башне')
    tc.cool = 99
    tw.cool = 0
    tw.target = None
    n0 = len(w.projectiles)
    tw.update(w, 0.01)
    check(len(w.projectiles) - n0 in (0, 4), 'башня с 3 стрелками: 4 стрелы (или враг вне дальности)')
    w.damage(tw, enemy, tw.hp + 10)
    check(not tw.alive, 'башня разрушена')
    check(all(a.alive and a in w.units and a.inside is None for a in arch), 'все лучники вышли при разрушении')
    # мин. дальность башни и бойницы
    tw2 = w.place_building('tower', 0, tc.tx + 12, tc.ty + 12, complete=True)
    close = Unit('militia', 1, (tc.tx + 13.5) * TILE, (tc.ty + 12.5) * TILE, w)
    w.units.append(close)
    tw2.cool = 0
    tw2.target = None
    n0 = len(w.projectiles)
    tw2.update(w, 0.01)
    shot = [pr for pr in w.projectiles[n0:] if pr.src is tw2]
    check(all(pr.target is not close for pr in shot), 'башня не бьёт вплотную (мин. дальность 1)')
    w.apply_tech(w.players[0], 'murder_holes')
    tw2.cool = 0
    tw2.target = None
    n0 = len(w.projectiles)
    tw2.update(w, 0.01)
    check(any(pr.target is close for pr in w.projectiles[n0:]), 'с «Бойницами» бьёт вплотную')


def test_bell():
    print('набат и «всё чисто»')
    w, tc = clear_world()
    vs = [u for u in w.units if u.owner == 0 and u.kind == 'villager']
    for i in range(6):
        vs.append(vil(w, 0, tc.tx - 6 + i, tc.ty + 7))
    tree = None
    for n in w.nodes:
        if n.kind == 'tree':
            tree = n
            break
    # поставить дерево и ферму поближе
    from game.world import Node
    tree = Node('tree', tc.tx - 6, tc.ty - 6)
    w.nodes.append(tree)
    w.occ[tree.ty][tree.tx] = tree
    farm = w.place_building('farm', 0, tc.tx + 6, tc.ty - 1, complete=True)
    site = w.place_building('house', 0, tc.tx - 7, tc.ty + 1)
    vs[0].cmd_gather(tree)
    vs[1].cmd_gather(farm)
    vs[2].cmd_build(site)
    run(w, 3)
    before = {id(v): (v.state, v.target) for v in vs[:3]}
    n = defense.ring_bell(w, 0)
    check(n == len(vs), f'набат: все {len(vs)} жителей побежали в укрытие ({n})')
    ok = run(w, 40, lambda: all(v.inside is not None for v in vs))
    check(ok, 'все жители внутри')
    check(sum(len(b.garrison) for b in w.buildings) == len(vs), 'гарнизон = число жителей')
    k = defense.all_clear(w, 0)
    check(k == len(vs), 'всё чисто: все вышли')
    check(all(v.alive and v.inside is None for v in vs), 'все на карте')
    check((vs[0].state, vs[0].target) == before[id(vs[0])], 'дровосек вернулся к своему дереву')
    check((vs[1].state, vs[1].target) == before[id(vs[1])], 'фермер вернулся на свою ферму')
    check((vs[2].state, vs[2].target) == before[id(vs[2])], 'строитель вернулся к стройке')


def test_tower_upgrade():
    print('улучшение башен')
    w, tc = clear_world()
    p = w.players[0]
    t1 = w.place_building('tower', 0, tc.tx + 7, tc.ty, complete=True)
    t2 = w.place_building('tower', 0, tc.tx + 7, tc.ty + 3)
    t1.hp = t1.max_hp / 2
    p.age = 2
    ok, why = w.tech_state(p, 'guard_tower')
    check(ok, f'караульную можно изучить в эпоху замков ({why})')
    w.apply_tech(p, 'guard_tower')
    check(t1.kind == 'guard_tower' and t2.kind == 'guard_tower', 'существующие башни стали караульными')
    check(t1.max_hp == 1500 and abs(t1.hp - 750) < 1, 'доля ОЗ сохранилась (750/1500)')
    t3 = w.place_building('tower', 0, tc.tx + 7, tc.ty + 6)
    check(t3.kind == 'guard_tower', 'новая башня строится сразу караульной')
    p.age = 3
    w.apply_tech(p, 'keep')
    check(all(t.kind == 'keep' for t in (t1, t2, t3)), 'крепостные башни')
    check(t1.atk() == 7 and t1.garrison == [] and t1.d['garrison'] == 5, 'крепостная: атака 7, гарнизон 5')
    w.apply_tech(p, 'masonry')
    check(abs(tc.max_hp - 2400 * 1.1) < 1, 'кладка: +10% ОЗ зданиям')


def main():
    for t in (test_wall_line, test_gate, test_breach, test_garrison, test_bell, test_tower_upgrade):
        t()
    print('провалов:', len(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
