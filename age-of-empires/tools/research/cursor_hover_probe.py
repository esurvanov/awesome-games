#!/usr/bin/env python3
"""Проверка выбора состояния курсора (без окна): наводим «мышь» на объекты каждого типа при масштабе
1.0 / 0.7 / 1.4 и на возвышенности — какой курсор выбирает hud.cursor_kind и попадает ли entity_at в объект
из точки прицела (hotspot (1,1) — мышь и есть точка прицела; проверяем ещё точку «визуального острия»
картинки, т.е. куда игрок думает, что указывает).
  SDL_VIDEODRIVER=dummy .venv/bin/python tools/research/cursor_hover_probe.py
"""
import json
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import pygame  # noqa: E402

from game.ui import Game  # noqa: E402
from game.world import Unit, Building, Node, Animal  # noqa: E402

# смещение «визуального острия» относительно точки мыши (из static.json: tip − hot, лог. px, после масштабирования до 32)
VISUAL_TIP = {'arrow': (-1, 30), 'attack': (-1, -1), 'build': (-1, -1), 'repair': (-1, -1), 'garrison': (-1, -1),
              'tree': (4, 0), 'gold': (4, 0), 'stone': (4, 0), 'berries': (4, 0), 'farm': (4, 0), 'meat': (4, 0),
              'fish': (4, 0), 'drop': (4, 0), 'heal': (4, 0), 'rally': (0, 0), 'no': (0, 0)}


def main():
    random.seed(7)
    g = Game()
    g.new_game(1, 1, False, ai_human=True)
    w = g.world
    while w.time < 240 and w.winner is None:
        w.update(0.034)
        w.events.clear()
    w.update_fog()
    for i in range(len(w.vis)):          # снять туман: враг и дальние объекты видны (проверяем курсор, не разведку)
        w.vis[i] = 1
        w.explored[i] = 1
    for b in w.buildings:                # здания рисуются (и ловятся под мышью) только после «seen»
        b.seen = True
    vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager' and u.alive)
    vil.carry = 5
    g.selected = [vil]
    g.state = 'play'
    mine = [u for u in w.units if u.owner == 0]
    targets = []
    for kind in ('tree', 'gold', 'stone', 'berries', 'fish'):
        n = min((n for n in w.nodes if n.kind == kind and n.amount > 0), key=lambda n: (n.center()[0] - vil.x) ** 2 + (n.center()[1] - vil.y) ** 2, default=None)
        if n:
            targets.append((kind, n, kind))
    for kind, exp in (('farm', 'farm'), ('town_center', 'drop')):
        b = next((b for b in w.buildings if b.owner == 0 and b.kind == kind and b.complete), None)
        if b:
            targets.append((kind, b, exp))
    b = next((b for b in w.buildings if b.owner == 0 and not b.complete), None)
    if b:
        targets.append(('build_site', b, 'build'))
    a = next((a for a in w.animals if not a.dead and a.den is None), None)
    if a:
        targets.append(('animal', a, 'meat'))
    e = next((u for u in w.units if u.owner >= 1 and u.alive and w.hostile(0, u.owner)), None)
    if e:
        targets.append(('enemy_unit', e, 'attack'))
    eb = next((b for b in w.buildings if b.owner >= 1 and w.hostile(0, b.owner)), None)
    if eb:
        targets.append(('enemy_building', eb, 'attack'))
    own = next((u for u in mine if u is not vil and u.alive), None)
    if own:
        targets.append(('own_unit', own, 'arrow'))
    mil = next((u for u in mine if u.alive and u.cls in ('inf', 'arch')), None)
    tc = next((b for b in w.buildings if b.owner == 0 and b.kind == 'town_center' and b.complete), None)
    if mil and tc:
        targets.append(('tc_garrison_mil', tc, 'garrison'))
    out = []
    for zoom in (1.0, 0.7, 1.4):
        for name, obj, exp in targets:
            cx, cy = obj.center()
            g.selected = [mil] if name == 'tc_garrison_mil' else [vil]
            g.set_zoom(zoom)
            g.center_on(cx, cy)
            g.set_zoom(zoom, (640, 400))
            g.draw()                 # entity_at смотрит в self.drawn — список спрайтов последнего кадра
            h = w.z_at(cx, cy)
            sx, sy = g.w2s(cx, cy)
            if isinstance(obj, Unit):
                sy -= 12 * zoom          # тело фигурки выше точки ног
            elif isinstance(obj, Node) and obj.kind == 'tree':
                sy -= 20 * zoom
            mp = (int(sx), int(sy))
            got = g.cursor_kind(mp)
            hit = g.entity_at(mp)
            # куда указывает «визуальное остриё» картинки: объект под ним
            dx, dy = VISUAL_TIP.get(got, (0, 0))
            vis_hit = g.entity_at((mp[0] + dx, mp[1] + dy))
            out.append(dict(zoom=zoom, target=name, expected=exp, got=got, ok=got == exp,
                            hit_is_target=hit is obj, elev=round(h, 1),
                            visual_tip_hits_target=vis_hit is obj, mouse=mp))
    # возвышенность: объект с наибольшей высотой
    g.selected = [vil]
    hi = max((n for n in w.nodes if n.alive and n.amount > 0), key=lambda n: w.z_at(*n.center()))
    for zoom in (1.0, 0.7, 1.4):
        g.set_zoom(zoom)
        hx_, hy_ = hi.center()
        g.center_on(hx_, hy_)
        g.draw()
        sx, sy = g.w2s(hx_, hy_)
        mp = (int(sx), int(sy - (20 * zoom if hi.kind == 'tree' else 0)))
        got = g.cursor_kind(mp)
        exp = hi.kind if hi.kind in ('tree', 'gold', 'stone', 'berries') else 'fish'
        out.append(dict(zoom=zoom, target=f'elevated_{hi.kind}', expected=exp, got=got, ok=got == exp,
                        hit_is_target=g.entity_at(mp) is hi, elev=round(w.z_at(hx_, hy_), 1), mouse=mp,
                        visual_tip_hits_target=g.entity_at((mp[0] + VISUAL_TIP.get(got, (0, 0))[0],
                                                           mp[1] + VISUAL_TIP.get(got, (0, 0))[1])) is hi))
    # режимы приказа и размещение
    g.set_zoom(1.0)
    g.center_on(vil.x, vil.y)
    g.draw()
    mp = g.w2s(vil.x, vil.y)
    mp = (int(mp[0]), int(mp[1]))
    for mode in ('patrol', 'guard', 'follow', 'amove', 'aground', 'flare'):
        g.order_mode = mode
        out.append(dict(zoom=1.0, target=f'order_{mode}', expected='(DE: свой значок)', got=g.cursor_kind(mp), ok=None))
    g.order_mode = None
    g.selected = []
    out.append(dict(zoom=1.0, target='nothing_selected_over_tree', expected='arrow', got=g.cursor_kind(mp), ok=None))
    path = os.path.join('shots', 'research_cursor', 'hover.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for r in out:
        print(f"z={r['zoom']:<4} {r['target']:22} ожид={r['expected']:10} получ={r['got']:8} ok={r['ok']} "
              f"hit={r.get('hit_is_target')} vis_tip_hit={r.get('visual_tip_hits_target')} h={r.get('elev')}")


if __name__ == '__main__':
    main()
