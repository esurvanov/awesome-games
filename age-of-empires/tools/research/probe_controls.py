#!/usr/bin/env python3
"""Исследование «Мышь и управление»: безоконные замеры поведения нашего интерфейса для сверки с AoE2 DE.

Ничего в игре не меняет — только создаёт партию, раздаёт приказы через Game.on_event / Game.command и печатает
факты (см. docs/research/01_controls.md).

  SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy .venv/bin/python tools/research/probe_controls.py
"""
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import pygame  # noqa: E402

from game.data import TILE, SCREEN_W, TOP_H, VIEW_H  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit, Building  # noqa: E402

MODS = [0]


def out(key, val):
    print(f'{key:<34} {val}')


def ev(g, typ, **kw):
    g.on_event(pygame.event.Event(typ, **kw))


def lclick(g, pos):
    ev(g, pygame.MOUSEBUTTONDOWN, pos=pos, button=1)
    ev(g, pygame.MOUSEBUTTONUP, pos=pos, button=1)


def box(g, a, b):
    ev(g, pygame.MOUSEBUTTONDOWN, pos=a, button=1)
    ev(g, pygame.MOUSEBUTTONUP, pos=b, button=1)


def key(g, k, mod=0):
    MODS[0] = mod
    ev(g, pygame.KEYDOWN, key=k, mod=mod, unicode='', scancode=0)
    MODS[0] = 0


def spawn(g, kind, x, y, owner=0):
    u = Unit(kind, owner, x, y, g.world)
    g.world.units.append(u)
    return u


def run(g, sec, dt=0.034):
    w = g.world
    for _ in range(int(sec / dt)):
        w.update(dt)


def main():
    random.seed(1)
    g = Game()
    g.mods = lambda: MODS[0]
    g.new_game(1, opponents=1, map_type='land', civ='britons')
    w = g.world
    w.ais = []                          # ИИ не мешает замерам
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    cx, cy = tc.center()
    # поле для опытов: 8 клеток ниже центра
    fx, fy = cx + 6 * TILE, cy + 6 * TILE
    g.center_on(fx, fy)
    for u in list(w.units):
        if u.owner == 0 and u.kind != 'villager':
            w.units.remove(u)

    # ---- 1. рамка: лимит, типы, здания
    army = []
    for i in range(80):
        army.append(spawn(g, 'militia' if i % 2 else 'archer', fx - 5 * TILE + (i % 10) * 20, fy - 2 * TILE + (i // 10) * 20))
    vils = [u for u in w.units if u.owner == 0 and u.kind == 'villager']
    vils += [spawn(g, 'villager', cx - 4 * TILE + i * 12, cy + 3 * TILE) for i in range(8 - len(vils))]
    g.draw()
    box(g, (0, TOP_H + 1), (SCREEN_W - 1, TOP_H + VIEW_H - 1))
    kinds = {}
    for s in g.selected:
        kinds[s.kind] = kinds.get(s.kind, 0) + 1
    out('box: выбрано всего', len(g.selected))
    out('box: по видам', kinds)
    out('box: зданий в выборе', sum(isinstance(s, Building) for s in g.selected))

    # ---- 2. группа Ctrl+1 со зданием; Shift+1; Ctrl+0
    g.selected = [army[0], tc]
    key(g, pygame.K_1, pygame.KMOD_CTRL)
    out('Ctrl+1 [юнит+ЦГ] → в группе', [s.kind for s in g.groups.get(1, [])])
    g.selected = [tc]
    key(g, pygame.K_1, pygame.KMOD_CTRL)
    out('Ctrl+1 [только ЦГ] → в группе', [s.kind for s in g.groups.get(1, [])])
    g.selected = [army[1]]
    key(g, pygame.K_2, pygame.KMOD_CTRL)
    g.selected = [army[3]]
    key(g, pygame.K_2, pygame.KMOD_SHIFT)
    out('Shift+2 (добавить группу к выбору)', f'выбрано {len(g.selected)} (ждём 2)')
    g.selected = [army[4]]
    key(g, pygame.K_0, pygame.KMOD_CTRL)
    out('Ctrl+0 → группа 0', g.groups.get(0))

    # ---- 3. двойной щелчок / Ctrl+щелчок
    g.selected = []
    g.draw()
    a = army[11]
    p = g.w2s(a.x, a.y - 4)
    p = (int(p[0]), int(p[1] - 10))
    lclick(g, p)
    lclick(g, p)
    out('двойной щелчок по лучнику → выбрано', f'{len(g.selected)} ({ {s.kind for s in g.selected} })')
    g.selected = [army[0]]
    g.last_click = (0, None)
    MODS[0] = pygame.KMOD_CTRL
    lclick(g, p)
    MODS[0] = 0
    out('Ctrl+щелчок при выбранном юните', f'выбрано {len(g.selected)} (DE: добавить/убрать → 2)')

    # ---- 4. допуск щелчка по юниту
    lone = spawn(g, 'militia', fx + 9 * TILE, fy - 4 * TILE)
    g.draw()
    sx, sy = g.w2s(lone.x, lone.y)
    hx = next((dx for dx in range(0, 80) if g.entity_at((int(sx) + dx, int(sy) - 15)) is not lone), None)
    top = next((dy for dy in range(0, 120) if g.entity_at((int(sx), int(sy) - dy)) is not lone), None)
    bot = next((dy for dy in range(0, 60) if g.entity_at((int(sx), int(sy) + dy)) is not lone), None)
    out('зона щелчка по юниту, px', f'±{hx} по X, {top} вверх от ног, {bot} вниз; спрайт ~{g.civ_of(0) and 0}')
    w.units.remove(lone)

    # ---- 5. клавиши . и ,
    for u in army:
        u.stop()
    for v in vils:
        v.stop()
    g.selected = []
    key(g, pygame.K_COMMA)
    out(', (DE: след. праздный военный)', [s.kind for s in g.selected])
    key(g, pygame.K_PERIOD, pygame.KMOD_SHIFT)
    out('Shift+. (DE: все праздные жители)', f'выбрано {len(g.selected)}')

    # ---- 6. Esc без выбора, колесо мыши
    g.selected = []
    key(g, pygame.K_ESCAPE)
    out('Esc при пустом выборе → пауза', g.paused)
    g.paused = False
    c0 = (g.cam_x, g.cam_y)
    ev(g, pygame.MOUSEWHEEL, x=0, y=1, flipped=False, precise_x=0.0, precise_y=1.0, touch=False)
    out('колесо вверх → сдвиг камеры', (round(g.cam_x - c0[0]), round(g.cam_y - c0[1])))

    # ---- 7. скорость прокрутки
    sp = 1000
    out('прокрутка, px/с экрана', sp)
    out('прокрутка, клеток/с (по X экрана)', round(sp / (2 * 32), 1))

    # ---- 8. строй: разброс и согласование скорости
    g.selected = []
    for u in army:
        w.units.remove(u)
    sc = spawn(g, 'scout', fx, fy)
    mil = spawn(g, 'militia', fx + 10, fy)
    arc = spawn(g, 'archer', fx + 20, fy)
    grp = [sc, mil, arc]
    g.selected = grp
    tx, ty = fx + 14 * TILE, fy
    g.command(tx, ty, None)
    arrive = {}
    t = 0.0
    while t < 40 and len(arrive) < 3:
        run(g, 0.1)
        t += 0.1
        for u in grp:
            if u.kind not in arrive and math.hypot(u.x - tx, u.y - ty) < 1.2 * TILE:
                arrive[u.kind] = round(t, 1)
    out('14 клеток: время прибытия, с', arrive)
    pts = [(round((u.x - tx) / TILE, 2), round((u.y - ty) / TILE, 2)) for u in grp]
    out('точки прибытия (клетки от цели)', pts)

    # ---- 9. Shift+ПКМ: очередь точек
    g.selected = [mil]
    MODS[0] = pygame.KMOD_SHIFT
    g.command(fx, fy + 4 * TILE, None)
    g.command(fx + 4 * TILE, fy + 4 * TILE, None)
    MODS[0] = 0
    out('Shift+ПКМ ×2 → цель юнита', (round(mil.pending[0] / TILE, 1), round(mil.pending[1] / TILE, 1))
        if mil.pending else mil.state)
    out('  (точек в очереди)', len(mil.orders or ()))

    # ---- 10. ремонт
    house = w.place_building('house', 0, int(fx // TILE) - 6, int(fy // TILE) + 3, complete=True)
    house.hp = house.max_hp * 0.5
    v = vils[0]
    v.carry = 0
    g.selected = [v]
    g.command(*house.center(), house)
    out('ПКМ жителем по раненому дому → state', v.state)
    g.draw()
    hp = g.w2s(*house.center())
    out('  курсор над ним', g.cursor_kind((int(hp[0]), int(hp[1]) - 10)))

    # ---- 11. ферма: три жителя
    farm = w.place_building('farm', 0, int(fx // TILE) + 2, int(fy // TILE) + 4, complete=True)
    three = vils[1:4]
    g.selected = three
    g.command(*farm.center(), farm)
    out('ПКМ 3 жителями по ферме → states', [u.state for u in three])

    # ---- 12. Del по зданию; Shift+Del
    g.selected = [house]
    key(g, pygame.K_DELETE)
    out('Del по выбранному дому → жив', house.alive)

    # ---- 13. точка сбора на своём здании (гарнизон?)
    g.selected = [tc]
    g.command(*house.center(), house)
    out('точка сбора ЦГ на дом', type(tc.rally).__name__)
    # точка сбора ЦГ на сам ЦГ
    g.command(*tc.center(), tc)
    nu = w.spawn(tc, 'villager')
    out('точка сбора ЦГ на себя → житель', nu.state if nu else 'нет spawn_unit')

    # ---- 14. Shift+закладка двух домов двумя жителями
    g.selected = vils[4:6]
    g.placing = 'house'
    MODS[0] = pygame.KMOD_SHIFT
    w.players[0].res['wood'] = 1000
    placed = []
    for dx in (0, 4):
        bx, by = int(fx // TILE) + 6 + dx, int(fy // TILE) - 6
        pos = g.w2s((bx + 1) * TILE, (by + 1) * TILE)
        n0 = len(w.buildings)
        g.try_place((int(pos[0]), int(pos[1])))
        if len(w.buildings) > n0:
            placed.append(w.buildings[-1])
    MODS[0] = 0
    out('Shift: заложено домов', len(placed))
    out('  цели жителей = последний дом?', [u.target is placed[-1] for u in vils[4:6]] if placed else '-')
    out('  режим закладки остался', g.placing)
    g.placing = None

    # ---- 15. приоритет своего юнита над врагом при наложении
    en = spawn(g, 'militia', mil.x + 6, mil.y + 2, owner=1)
    g.draw()
    ep = g.w2s(en.x, en.y)
    e = g.entity_at((int(ep[0]), int(ep[1]) - 12))
    out('щелчок по врагу поверх своего → кто', 'свой' if e is mil else ('враг' if e is en else e))
    w.units.remove(en)

    # ---- 16. порядок в рамке — лимит 60 нет, сортировки нет
    g.selected = []
    box(g, (0, TOP_H + 1), (SCREEN_W - 1, TOP_H + VIEW_H - 1))
    ys = [g.w2s(u.x, u.y)[1] for u in g.selected]
    out('рамка: сортировка «сверху вниз»', ys == sorted(ys))


if __name__ == '__main__':
    main()
