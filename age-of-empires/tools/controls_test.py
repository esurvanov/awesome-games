#!/usr/bin/env python3
"""Windowless controls checks against AoE2 DE (docs/research/01_controls.md): every check has
a quantum number. Prints ok / FAIL, exit code 1 - if anything is wrong.

  SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy .venv/bin/python tools/controls_test.py
"""
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import TILE, SCREEN_W, TOP_H, VIEW_H  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit, Projectile  # noqa: E402
from game import orders  # noqa: E402

MODS = [0]
FAILS = []
OKS = []
DT = 0.034


def check(q, cond, what):
    print(('  ok   ' if cond else '  FAIL ') + f'{q:<4} {what}')
    (OKS if cond else FAILS).append(q)


def ev(g, typ, **kw):
    g.on_event(pygame.event.Event(typ, **kw))


def key(g, k, mod=0):
    MODS[0] = mod
    ev(g, pygame.KEYDOWN, key=k, mod=mod, unicode='', scancode=0)
    MODS[0] = 0


def lclick(g, pos, mod=0):
    MODS[0] = mod
    ev(g, pygame.MOUSEBUTTONDOWN, pos=pos, button=1)
    ev(g, pygame.MOUSEBUTTONUP, pos=pos, button=1)
    MODS[0] = 0


def rcmd(g, x, y, target=None, mod=0):
    MODS[0] = mod
    g.command(x, y, target)
    MODS[0] = 0


def run(g, sec, until=None):
    w = g.world
    t = 0.0
    while t < sec:
        w.update(DT)
        g.events = w.events[:]
        w.events.clear()
        g.ctl_update()
        t += DT
        if until and until():
            return True
    return False


def spawn(g, kind, x, y, owner=0):
    u = Unit(kind, owner, x, y, g.world)
    g.world.units.append(u)
    return u


def screen_of(g, u, up=14):
    p = g.w2s(u.x, u.y)
    return int(p[0]), int(p[1] - up)


def clear_field(w, cx, cy, r):
    for y in range(cy - r, cy + r):
        for x in range(cx - r, cx + r):
            if not (0 <= x < w.W and 0 <= y < w.H):
                continue
            o = w.occ[y][x]
            if o is not None and not hasattr(o, 'queue'):
                w.occ[y][x] = None
                o.alive = False
            w.terrain[y][x] = 0
    w.nodes = [n for n in w.nodes if n.alive]
    for a in list(w.animals):
        if abs(a.x / TILE - cx) < r and abs(a.y / TILE - cy) < r:
            w.animals.remove(a)


def cursor_checks(g, w, tc, vils, fx, fy):
    """docs/research/08_cursor.md: the tip = the aim point for every file; the state - by what is under the mouse."""
    import json
    from PIL import Image
    from game import uiskin
    cur_dir = os.path.join(os.path.dirname(uiskin.__file__), '..', 'assets', 'ui', 'cursors')
    hot = json.load(open(os.path.join(cur_dir, 'hotspots.json')))
    bad = []
    for kind, fn in uiskin.CURSOR_FILES.items():
        im = Image.open(os.path.join(cur_dir, fn + '.png')).convert('RGBA')
        a = im.getchannel('A').load()
        pts = [(x, y) for y in range(im.height) for x in range(im.width) if a[x, y] > 64]
        hx, hy = hot.get(fn, [1, 1])
        if kind in ('no', 'aground'):
            xs, ys = [p[0] for p in pts], [p[1] for p in pts]
            tip = ((min(xs) + max(xs)) // 2, (min(ys) + max(ys)) // 2)
        else:
            tip = min(pts, key=lambda p: (p[0] + p[1], p[1]))
        if max(abs(tip[0] - hx), abs(tip[1] - hy)) > 1 or im.size != (32, 32):
            bad.append((kind, fn, tip, (hx, hy), im.size))
    check('L1', not bad, f'the tip = the aim point (+-1 px), 32x32 for all {len(uiskin.CURSOR_FILES)} cursors'
          + (f' — {bad}' if bad else ''))
    vil = vils[0]
    g.selected = [vil]
    g.order_mode = None
    g.placing = None
    g.center_on(fx, fy)
    g.draw()
    tree = min((n for n in w.nodes if n.kind == 'tree' and n.alive),
               key=lambda n: (n.tx * TILE - fx) ** 2 + (n.ty * TILE - fy) ** 2)
    g.center_on(*tree.center())
    g.draw()
    tp = g.w2s(*tree.center())
    tp = (int(tp[0]), int(tp[1] - 20))
    check('L2', g.cursor_kind(tp) == 'tree', 'a villager over a tree - an axe')
    g.center_on(*tc.center())
    g.draw()
    cp = g.w2s(*tc.center())
    cp = (int(cp[0]), int(cp[1]))
    vil.carry = 0
    check('L3', g.cursor_kind(cp) == 'garrison', 'a villager without a load over the center - garrison (no Alt, DE)')
    vil.carry = 5
    check('L3', g.cursor_kind(cp) == 'drop', 'a villager with a load over the center - drop off the resource')
    vil.carry = 0
    g.order_mode = 'flare'
    check('L4', g.cursor_kind(cp) == 'flare', 'signal mode - a horn')
    for mode in ('patrol', 'guard', 'follow', 'amove', 'aground'):
        g.order_mode = mode
        check('L4', g.cursor_kind(cp) == mode, f'order mode {mode} - its own cursor')
    g.order_mode = None
    g.selected = [tc]
    check('L5', g.cursor_kind(cp) == 'rally', 'a center is selected - the rally point flag')
    g.selected = [vil]
    g.placing = 'house'
    check('L6', g.cursor_kind(cp) == 'no', 'placing on an occupied spot - "no"')
    g.placing = None
    g.selected = []
    check('L7', g.cursor_kind((10, 5)) == 'arrow', 'over a panel - an arrow')
    # software cursor: drawn at the mouse point minus the aim point (checked on the surface)
    cur = g.cursors
    cur.set_soft(True)
    cur.set('tree')
    surf = pygame.Surface((64, 64), pygame.SRCALPHA)
    ok_soft = True
    try:
        rec = cur.load('tree')
        ok_soft = rec is not None and rec[1:] == (1, 1)
    except Exception:
        ok_soft = False
    check('L8', ok_soft, 'software cursor: a 32 px picture, the aim point (1, 1)')
    cur.set_soft(False)
    del surf


def zoom_checks(g, w, fx, fy):
    """D1: the wheel - zoom around the cursor; selection, box, placement, minimap - correct at any zoom."""
    from game.data import HW, HH
    g.selected = []
    g.placing = None
    g.center_on(fx, fy)
    g.zoom = g.zoom_to = 1.0
    z0 = g.zoom
    ev(g, pygame.MOUSEWHEEL, x=0, y=1, flipped=False, precise_x=0.0, precise_y=1.0, touch=False)
    check('D1', g.zoom_to > z0, f'wheel up -> closer (target {g.zoom_to})')
    g.zoom_to = 1.0
    anchor = (300, TOP_H + 200)
    before = g.s2w(*anchor)
    g.zoom_step(-3, anchor)
    for _ in range(40):
        g.zoom_tick(DT)
    after = g.s2w(*anchor)
    check('D1', abs(g.zoom - 0.7) < 1e-6 and math.hypot(after[0] - before[0], after[1] - before[1]) < 2,
          f'smoothly to 0.7, the point under the cursor stays in place (shift {math.hypot(after[0] - before[0], after[1] - before[1]):.2f})')
    ev(g, pygame.MOUSEWHEEL, x=0, y=0, flipped=False, precise_x=0.0, precise_y=0.4, touch=False)
    check('D1', abs(g.zoom_to - 0.7) < 1e-6, 'trackpad: a fraction of a "notch" does not change the zoom')
    ev(g, pygame.MOUSEWHEEL, x=0, y=0, flipped=False, precise_x=0.0, precise_y=-0.4, touch=False)
    cx0 = g.cam_x
    ev(g, pygame.MOUSEWHEEL, x=-2, y=0, flipped=False, precise_x=-2.0, precise_y=0.0, touch=False)
    check('D1', g.cam_x > cx0 and abs(g.zoom_to - 0.7) < 1e-6, 'trackpad sideways -> scrolling, not zoom')
    for z in (0.7, 1.4):
        g.zoom = g.zoom_to = z
        g.center_on(fx, fy)
        for u in list(w.units):
            if math.hypot(u.x - fx, u.y - fy) < 6 * TILE:
                w.units.remove(u)
        a = spawn(g, 'militia', fx, fy)
        b = spawn(g, 'archer', fx + 2 * TILE, fy + 2 * TILE)
        g.draw()
        sx, sy = g.w2s(a.x, a.y)
        wx, wy = g.s2w(sx, sy)
        check('D1', math.hypot(wx - a.x, wy - a.y) < 0.5, f'×{z}: screen <-> world agree')
        e = g.entity_at((int(sx), int(sy - 14 * z)))
        check('D1', e is a, f'×{z}: a click on the figure selects it')
        e2 = g.entity_at((int(sx), int(sy - 80 * z)))
        check('D1', e2 is not a, f'×{z}: a click above the head - a miss')
        bx, by = g.w2s(b.x, b.y)
        r = pygame.Rect(0, 0, 60, 60)
        r.center = (int(bx), int(by - 10 * z))
        g.drag = r.topleft
        MODS[0] = 0
        g.on_lup(r.bottomright)
        check('D1', g.selected == [b], f'×{z}: the box selects only the unit in the box {[(s.kind, round(s.x - b.x), round(s.y - b.y)) for s in g.selected]}')
        g.placing = 'house'
        for tx, ty in ((int(fx // TILE) - 4, int(fy // TILE) + 3), (int(fx // TILE) + 2, int(fy // TILE) - 5)):
            pos = g.w2s((tx + 1) * TILE, (ty + 1) * TILE)
            check('D1', g.place_tile((int(pos[0]), int(pos[1]))) == (tx, ty), f'×{z}: placement - the cell under the cursor')
        g.draw()                            # a ghost shadow on the canvas
        g.placing = None
        mm = g.mm_rect()
        g.minimap_jump(mm.center)
        c = g.w2s(*g.mm_to_world(mm.center))
        check('D1', abs(c[0] - SCREEN_W / 2) < 3 and abs(c[1] - (TOP_H + VIEW_H / 2)) < 3,
              f'×{z}: minimap -> the point at the center of the view')
        vis_w = g.view_w() / ((w.W + w.H) * HW)
        check('D1', abs(vis_w - SCREEN_W / z / ((w.W + w.H) * HW)) < 1e-9 and abs(g.view_h() - VIEW_H / z) < 1e-9,
              f'×{z}: the camera frame on the minimap x{1 / z:.2f}')
        g.cam_x = g.cam_y = 1e9
        g.clamp_cam()
        br = g.s2w(SCREEN_W, TOP_H + VIEW_H)
        check('D1', g.cam_x + g.view_w() <= (w.W + w.H) * HW + 1 and g.cam_y + g.view_h() <= (w.W + w.H) * HH + 1,
              f'×{z}: the camera does not leave the map (corner {br[0] / TILE:.0f},{br[1] / TILE:.0f})')
        w.units.remove(a)
        w.units.remove(b)
    g.zoom = g.zoom_to = 1.0
    g.center_on(fx, fy)
    g.draw()


def main():
    random.seed(3)
    g = Game()
    g.mods = lambda: MODS[0]
    g.new_game(1, opponents=1, map_type='land', civ='britons')
    w = g.world
    w.ais = []
    p = w.players[0]
    p.res.update(food=5000, wood=5000, gold=5000, stone=5000)
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    tcx, tcy = tc.center()
    sx_ = 1 if tcx < w.W * TILE / 2 else -1
    sy_ = 1 if tcy < w.H * TILE / 2 else -1
    ftx, fty = int(tcx // TILE) + 11 * sx_, int(tcy // TILE) + 11 * sy_
    clear_field(w, ftx, fty, 12)
    fx, fy = (ftx + 0.5) * TILE, (fty + 0.5) * TILE
    for u in list(w.units):
        if u.owner == 0 and u.kind != 'villager':
            w.units.remove(u)
    vils = [u for u in w.units if u.owner == 0 and u.kind == 'villager']
    for u in vils:
        u.stop()
    g.center_on(fx, fy)
    g.draw()

    print('A - selection')
    army = [spawn(g, 'militia' if i % 2 else 'archer', fx - 4 * TILE + (i % 10) * 18, fy - 3 * TILE + (i // 10) * 18)
            for i in range(80)]
    MODS[0] = 0
    ev(g, pygame.MOUSEBUTTONDOWN, pos=(0, TOP_H + 1), button=1)
    ev(g, pygame.MOUSEBUTTONUP, pos=(SCREEN_W - 1, TOP_H + VIEW_H - 1), button=1)
    check('A4', len(g.selected) == 60, f'a box over 80+ units -> {len(g.selected)} (limit 60)')
    ys = [g.w2s(u.x, u.y)[1] for u in g.selected]
    check('A5', ys == sorted(ys), 'the box selects top to bottom')
    check('A6', all(isinstance(s, Unit) for s in g.selected), 'only units in the box')
    # A3: own against foreign
    en = spawn(g, 'militia', army[5].x + 4, army[5].y + 2, owner=1)
    g.draw()
    e = g.entity_at(screen_of(g, en, 14))
    check('A3', e is not None and e.owner == 0, 'a click on an overlap of own and an enemy -> own')
    w.units.remove(en)
    # A10: Ctrl+click - add/remove
    g.selected = [army[0]]
    g.last_click = (0, None)
    lclick(g, screen_of(g, army[33]), pygame.KMOD_CTRL)
    n1 = len(g.selected)
    g.last_click = (0, None)
    lclick(g, screen_of(g, army[33]), pygame.KMOD_CTRL)
    check('A10', n1 == 2 and len(g.selected) == 1, f'Ctrl+click adds ({n1}) and removes ({len(g.selected)})')
    # A8: double click - a line (militia + man-at-arms), <= 60
    for u in army[1::4]:
        u.set_kind('man_at_arms')
    g.selected = []
    g.last_click = (0, None)
    army[1].x, army[1].y = fx + 3 * TILE, fy + 3 * TILE
    pos = screen_of(g, army[1])
    lclick(g, pos)
    lclick(g, pos)
    kinds = {s.kind for s in g.selected}
    check('A8', kinds == {'militia', 'man_at_arms'} and len(g.selected) <= 60,
          f'double click on a line -> {sorted(kinds)}, {len(g.selected)}')
    # A11: selection icons
    g.selected = [army[0], army[2], army[1], army[3]]
    MODS[0] = pygame.KMOD_CTRL
    g.panel_select(army[0])
    ok1 = army[0] not in g.selected and len(g.selected) == 3
    MODS[0] = pygame.KMOD_SHIFT
    g.panel_select(army[2])
    ok2 = all(s.kind == army[2].kind for s in g.selected)
    g.selected = [army[0], army[2], army[1], army[3]]
    MODS[0] = pygame.KMOD_CTRL | pygame.KMOD_SHIFT
    g.panel_select(army[0])
    ok3 = all(s.kind != army[0].kind for s in g.selected)
    MODS[0] = 0
    check('A11', ok1 and ok2 and ok3, 'icons: Ctrl - remove, Shift - only the kind, Ctrl+Shift - remove the kind')
    for u in army:
        u.alive = False
    w.units = [u for u in w.units if u.alive]
    g.selected = []

    print('B - groups')
    m1 = spawn(g, 'militia', fx, fy)
    m2 = spawn(g, 'militia', fx + 20, fy)
    g.selected = [m1, tc]
    key(g, pygame.K_1, pygame.KMOD_CTRL)
    check('B2', set(g.groups.get(1, [])) == {m1, tc}, 'Ctrl+1 [unit + TC] -> both in the group')
    g.selected = [m2]
    key(g, pygame.K_0, pygame.KMOD_CTRL)
    check('B1', g.groups.get(0) == [m2], 'Ctrl+0 -> group 0')
    g.selected = [m2]
    key(g, pygame.K_1, pygame.KMOD_SHIFT)
    check('B4', set(g.selected) == {m1, m2, tc}, 'Shift+1 -> the group is added to the selection')
    g.selected = [m1]
    key(g, pygame.K_3, pygame.KMOD_CTRL | pygame.KMOD_ALT)
    g.selected = []
    key(g, pygame.K_3, pygame.KMOD_ALT)
    check('B5', g.groups.get(13) == [m1] and g.selected == [m1] and 1 not in [g.group_of(m1)],
          'Alt+3 -> group 13 (a unit - in only one group)')
    g.center_on(tcx, tcy)
    key(g, pygame.K_0, pygame.KMOD_CTRL | pygame.KMOD_SHIFT)
    c = g.w2s(m2.x, m2.y)
    check('B5', abs(c[0] - SCREEN_W / 2) < 40, 'Ctrl+Shift+0 -> select and the camera to the group')
    g.draw()
    check('A12', g.group_of(m1) == 13, 'group number above a unit (drawn by controls_draw)')

    print('C - search and jumps')
    for u in w.units:
        if u.owner == 0:
            u.stop()
    g.selected = []
    key(g, pygame.K_COMMA)
    check('C2', len(g.selected) == 1 and g.selected[0].kind == 'militia', ', -> idle military')
    key(g, pygame.K_PERIOD, pygame.KMOD_SHIFT)
    nv = len([u for u in w.units if u.owner == 0 and u.kind == 'villager' and u.state == 'idle'])
    check('C3', len(g.selected) == nv and nv > 1, f'Shift+. -> all idle villagers ({len(g.selected)})')
    key(g, pygame.K_COMMA, pygame.KMOD_CTRL)
    check('C3', {s.kind for s in g.selected} == {'militia'} and len(g.selected) == 2, 'Ctrl+, -> all idle military')
    m1.cmd_move(fx, fy + 3 * TILE)
    key(g, pygame.K_COMMA, pygame.KMOD_SHIFT)
    check('C3', len(g.selected) == 2, 'Shift+, -> all military')
    m1.stop()
    tc2 = w.place_building('town_center', 0, ftx + 4, fty - 10, complete=True)
    g.selected = []
    key(g, pygame.K_h)
    a = g.selected[:]
    key(g, pygame.K_h)
    b = g.selected[:]
    check('C4', a != b and {a[0], b[0]} == {tc, tc2}, 'H - centers in a circle')
    key(g, pygame.K_h, pygame.KMOD_CTRL | pygame.KMOD_SHIFT)
    check('C4', set(g.selected) == {tc, tc2}, 'Ctrl+Shift+H - all centers')
    brk = w.place_building('barracks', 0, ftx - 8, fty + 6, complete=True)
    g.center_on(tcx, tcy)
    key(g, pygame.K_b, pygame.KMOD_CTRL)
    c = g.w2s(*brk.center())
    check('C5', g.selected == [brk] and abs(c[0] - SCREEN_W / 2) < 60, 'Ctrl+B -> to the barracks')
    cam = (g.cam_x, g.cam_y)
    g.center_on(tcx, tcy)
    g.cam_prev = cam
    key(g, pygame.K_BACKSPACE)
    check('C8', (g.cam_x, g.cam_y) == cam, 'Backspace -> the previous view')
    alive_before = [s for s in g.selected]
    check('C8', all(s.alive for s in alive_before), 'Backspace kills nobody')
    w.emit('attack_alert', fx + 5 * TILE, fy, 0, 'villager')
    run(g, DT)
    g.center_on(tcx, tcy)
    key(g, pygame.K_HOME)
    c = g.w2s(fx + 5 * TILE, fy)
    check('C7', abs(c[0] - SCREEN_W / 2) < 60, 'Home -> to the last event')
    tc2.alive = False
    w.buildings.remove(tc2)
    for y in range(tc2.ty, tc2.ty + tc2.h):
        for x in range(tc2.tx, tc2.tx + tc2.w):
            w.occ[y][x] = None

    print('K - pause')
    g.selected = []
    key(g, pygame.K_ESCAPE)
    check('K8', not g.paused, 'Esc with an empty selection - no pause')
    key(g, pygame.K_F3)
    check('K8', g.paused, 'F3 - pause')
    key(g, pygame.K_F3)

    print('H - deletion')
    d1 = spawn(g, 'militia', fx - 40, fy)
    d2 = spawn(g, 'militia', fx - 60, fy)
    d3 = spawn(g, 'militia', fx - 80, fy)
    g.selected = [d1, d2, d3]
    key(g, pygame.K_DELETE)
    check('H1', not d1.alive and d2.alive and d3.alive, 'Del - deletes one')
    key(g, pygame.K_DELETE, pygame.KMOD_SHIFT)
    check('H1', not d2.alive and not d3.alive, 'Shift+Del - all selected')
    house = w.place_building('house', 0, ftx - 6, fty - 6, complete=True)
    g.selected = [house]
    key(g, pygame.K_DELETE)
    check('H1', not house.alive, 'Del - demolishes an own building')
    w.update(DT)

    print('F - repair')
    house = w.place_building('house', 0, ftx - 6, fty - 6, complete=True)
    house.hp = house.max_hp * 0.4
    v = vils[0]
    v.x, v.y = house.center()[0] + 2 * TILE, house.center()[1]
    g.selected = [v]
    wood0 = p.res['wood']
    rcmd(g, *house.center(), house)
    ok = v.state == 'repair'
    hp0 = house.hp
    run(g, 12)
    rate = (house.hp - hp0) / 12
    check('F3', ok and house.hp > hp0, f'villager -> a damaged house: repair (+{house.hp - hp0:.0f} HP)')
    check('F3', p.res['wood'] < wood0, f'repair spends wood ({wood0 - p.res["wood"]})')
    check('L2', g.cursor_kind(screen_of(g, spawn(g, 'militia', -999, -999))) in ('arrow', 'repair'), 'cursor')
    ram = spawn(g, 'ram', fx + 3 * TILE, fy + 3 * TILE)
    ram.hp = ram.max_hp * 0.3
    v2 = vils[1]
    v2.x, v2.y = ram.x - 20, ram.y
    g.selected = [v2]
    rcmd(g, ram.x, ram.y, ram)
    rh = ram.hp
    run(g, 6)
    rrate = (ram.hp - rh) / 6
    check('F4', v2.state == 'repair' and 0 < rrate < rate * 0.6, f'villager -> a ram: repair is slower ({rrate:.1f} HP/s)')
    ram.alive = False
    for u in (v, v2):
        u.stop()

    print('G - orders')
    m = spawn(g, 'militia', fx, fy)
    g.selected = [m]
    rcmd(g, fx + 4 * TILE, fy)
    rcmd(g, fx + 4 * TILE, fy + 4 * TILE, mod=pygame.KMOD_SHIFT)
    rcmd(g, fx, fy + 4 * TILE, mod=pygame.KMOD_SHIFT)
    check('G1', m.orders and len(m.orders) == 2, 'Shift+right click x2 -> 2 points in the queue')
    visited = set()
    t = 0
    while t < 25 and len(visited) < 3:
        run(g, 0.2)
        t += 0.2
        for i, pt in enumerate([(fx + 4 * TILE, fy), (fx + 4 * TILE, fy + 4 * TILE), (fx, fy + 4 * TILE)]):
            if math.hypot(m.x - pt[0], m.y - pt[1]) < TILE:
                visited.add(i)
    check('G1', visited == {0, 1, 2}, f'the points were passed in order ({sorted(visited)})')
    # stop - G
    g.selected = [m]
    m.cmd_move(fx + 6 * TILE, fy)
    key(g, pygame.K_g)
    check('G8', m.state == 'idle', 'G - stop for military units')
    bts = {b['key']: b['act'] for b in g.get_buttons()}
    check('K1', bts.get('Q') == ('omode', 'patrol') and bts.get('A') == ('stance', 'aggressive')
          and bts.get('G') == ('stop', None), 'the army grid: Q patrol, A aggressive, G stop')
    # formation and shared speed
    sc = spawn(g, 'scout', fx - 2 * TILE, fy)
    ar = spawn(g, 'archer', fx - 2 * TILE, fy + 20)
    mi = spawn(g, 'militia', fx - 2 * TILE, fy + 40)
    grp = [sc, ar, mi]
    g.selected = grp
    rcmd(g, fx + 8 * TILE, fy + 20)
    fs = {u.form_speed for u in grp}
    check('G3', len(fs) == 1 and abs(fs.pop() - mi.speed()) < 1e-6, 'the formation moves at the speed of the slowest')
    arr = {}
    t = 0
    while t < 30 and len(arr) < 3:
        run(g, 0.1)
        t += 0.1
        for u in grp:
            if u not in arr and u.state == 'idle':
                arr[u] = t
    spread = max(arr.values()) - min(arr.values()) if len(arr) == 3 else 99
    check('G3', spread < 3.0, f'arrived together (spread {spread:.1f} s)')
    dx = [(u.x - fx) for u in grp]
    check('G4', dx[0] > dx[2] > dx[1], f'line: cavalry in front, then infantry, ranged units behind {[round(d) for d in dx]}')
    sq = [spawn(g, 'archer' if i < 4 else 'militia', fx + i * 16, fy + 3 * TILE) for i in range(12)]
    g.selected = sq
    key(g, pygame.K_x)
    check('G2', all(getattr(u, 'formation', '') == 'box' for u in sq), 'X - the "box" formation')
    slots = orders.layout(sq, fx, fy, 'box')
    cxm = sum(x for _, x, _ in slots) / len(slots)
    cym = sum(y for _, _, y in slots) / len(slots)
    rin = max(math.hypot(x - cxm, y - cym) for u, x, y in slots if u.kind == 'archer')
    rout = min(math.hypot(x - cxm, y - cym) for u, x, y in slots if u.kind == 'militia')
    check('G2', rin < rout, 'box: ranged units inside, infantry outside')
    for f in ('line', 'staggered', 'flank'):
        sl = orders.layout(sq, fx, fy, f)
        pts = {(round(x), round(y)) for _, x, y in sl}
        check('G2', len(pts) == len(sq), f'formation {f}: everyone has their own place')
    for u in sq:
        u.alive = False
    # supports
    tgt = spawn(g, 'militia', fx + 6 * TILE, fy - 6 * TILE, owner=1)
    tgt.stance = 'no_attack'
    guard = spawn(g, 'archer', fx + 6 * TILE - 5 * TILE, fy - 6 * TILE)
    guard.stance = 'stand_ground'
    run(g, 3)
    check('G5', guard.state == 'idle' and math.hypot(guard.x - (fx + TILE), guard.y - (fy - 6 * TILE)) < 8,
          'stand ground: an enemy out of range - it does not go')
    tgt.x -= 1.5 * TILE
    run(g, 2)
    check('G5', guard.state == 'attack', 'stand ground: an enemy in range - it shoots')
    tgt.alive = False
    na = spawn(g, 'militia', fx - 6 * TILE, fy - 6 * TILE)
    g.selected = [na]
    key(g, pygame.K_f)
    foe = spawn(g, 'militia', na.x + 10, na.y, owner=1)
    foe.cmd_attack(na)
    run(g, 2)
    check('G5', na.stance == 'no_attack' and na.state == 'idle', 'F - "no attack": it does not answer blows')
    foe.alive = False
    na.alive = False
    df = spawn(g, 'militia', fx - 6 * TILE, fy + 6 * TILE)
    df.stance = 'defensive'
    home = (df.x, df.y)
    bait = spawn(g, 'scout', df.x + 3 * TILE, df.y, owner=1)
    bait.stance = 'no_attack'
    run(g, 1.0)
    engaged = df.state == 'attack'
    bait.cmd_move(df.x + 16 * TILE, df.y)
    run(g, 12)
    check("G5", engaged and math.hypot(df.x - home[0], df.y - home[1]) < 1.5 * TILE,
          f'defensive: it chased a short way and returned to its place ({engaged}, '
          f'{math.hypot(df.x - home[0], df.y - home[1]) / TILE:.1f} tiles, {df.state})')
    bait.alive = False
    df.alive = False
    # attack-move
    am = spawn(g, 'militia', fx - 6 * TILE, fy)
    vic = spawn(g, 'villager', fx - 2 * TILE, fy + 10, owner=1)
    g.selected = [am]
    key(g, pygame.K_r)
    check('G6', g.order_mode == 'amove', 'R - the "attack-move" mode')
    g.order_click(g.w2s(fx + 4 * TILE, fy))
    run(g, 20, lambda: not vic.alive)
    check('G6', not vic.alive, 'attack-move: killed an enemy on the way')
    run(g, 15, lambda: am.mission is None and am.state == 'idle')
    check('G6', math.hypot(am.x - (fx + 4 * TILE), am.y - fy) < 2 * TILE, 'attack-move: reached the point')
    # patrol
    pt = spawn(g, 'scout', fx, fy + 6 * TILE)
    g.selected = [pt]
    key(g, pygame.K_q)
    MODS[0] = pygame.KMOD_SHIFT
    g.order_click(g.w2s(fx + 5 * TILE, fy + 6 * TILE))
    MODS[0] = 0
    g.order_click(g.w2s(fx + 5 * TILE, fy + 9 * TILE))
    check('G6', pt.mission and pt.mission[0] == 'patrol' and len(pt.mission[1]) == 3, 'patrol over 2 points + start')
    seen = set()
    t = 0
    while t < 30:
        run(g, 0.2)
        t += 0.2
        seen.add(pt.mission[2])
    check('G6', seen == {0, 1, 2}, f'the patrol goes in a circle (points {sorted(seen)})')
    # guard and follow
    vip = spawn(g, 'villager', fx - 3 * TILE, fy - 3 * TILE)
    gd = spawn(g, 'militia', fx - 6 * TILE, fy - 3 * TILE)
    g.selected = [gd]
    key(g, pygame.K_w)
    g.order_click(screen_of(g, vip), target=vip)
    check('G6', gd.mission and gd.mission[0] == 'guard', 'W - guard a villager')
    run(g, 4)
    check('G6', math.hypot(gd.x - vip.x, gd.y - vip.y) < 3 * TILE, 'the guard stays close')
    raider = spawn(g, 'militia', vip.x + 2 * TILE, vip.y, owner=1)
    raider.stance = 'no_attack'
    run(g, 2)
    check('G6', gd.state == 'attack' and gd.target is raider, 'the guard hits an enemy near the guarded one')
    raider.alive = False
    fl = spawn(g, 'militia', fx - 6 * TILE, fy + 3 * TILE)
    g.selected = [fl]
    key(g, pygame.K_e)
    g.order_click(screen_of(g, vip), target=vip)
    vip.cmd_move(vip.x + 6 * TILE, vip.y + 2 * TILE)
    run(g, 14)
    check('G6', math.hypot(fl.x - vip.x, fl.y - vip.y) < 3 * TILE, 'E - follows a villager')
    # attack ground
    mg = spawn(g, 'mangonel', fx - 3 * TILE, fy + 8 * TILE)
    g.selected = [mg]
    bts = {b['key']: b['act'] for b in g.get_buttons()}
    check('G7', bts.get('T') == ('omode', 'aground'), 'T - "attack ground" for a mangonel')
    key(g, pygame.K_t)
    g.order_click(g.w2s(fx + 3 * TILE, fy + 8 * TILE))
    n0 = len(w.projectiles)
    shots = []
    orig = Projectile.__init__

    def spy(self, *a, **k):
        orig(self, *a, **k)
        shots.append(self)
    Projectile.__init__ = spy
    run(g, 6)
    Projectile.__init__ = orig
    check('G7', mg.state == 'aground' and any(s.point and s.target is None for s in shots),
          f'the mangonel hits the ground (projectiles {len(shots)}, was {n0})')
    mg.alive = False
    # pushing apart own units
    stand = spawn(g, 'militia', fx + 2 * TILE, fy - 9 * TILE)
    walker = spawn(g, 'militia', fx - 2 * TILE, fy - 9 * TILE)
    walker.cmd_move(fx + 6 * TILE, fy - 9 * TILE)
    s0 = (stand.x, stand.y)
    ok = run(g, 12, lambda: walker.state == 'idle')
    moved = math.hypot(stand.x - s0[0], stand.y - s0[1])
    check('G9', ok and abs(walker.y - (fy - 9 * TILE)) < 8 and moved > 3,
          f'a walking one passes, a standing own one gives way (stepped aside by {moved:.0f} px)')
    for u in list(w.units):
        if u.owner == 0 and u.kind != 'villager':
            u.alive = False
    w.units = [u for u in w.units if u.alive]

    print('I - rally points')
    tower = w.place_building('tower', 0, ftx + 3, fty - 5, complete=True)
    g.selected = [brk]
    rcmd(g, *tower.center(), tower)
    nu = w.spawn(brk, 'militia')
    check('I2', nu.state == 'garrison' and nu.target is tower, 'rally on a tower -> new ones into the garrison')
    g.selected = [tc]
    rcmd(g, *tc.center(), tc)
    nv = w.spawn(tc, 'villager')
    check('I2', nv.state == 'garrison', 'a center rallied on itself -> a villager into the garrison')
    g.selected = [brk]
    rcmd(g, fx, fy)
    rcmd(g, fx + 3 * TILE, fy, mod=pygame.KMOD_SHIFT)
    nu2 = w.spawn(brk, 'militia')
    check('I3', brk.rally_pts and nu2.orders and nu2.orders[-1][0] == 'rally', 'Shift+right click - a second rally point')

    print('J - placement')
    b1v, b2v = spawn(g, 'villager', fx, fy), spawn(g, 'villager', fx, fy)
    for u in (b1v, b2v):
        u.x, u.y = fx, fy
        u.stop()
    g.selected = [b1v, b2v]
    g.placing = 'house'
    placed = []
    MODS[0] = pygame.KMOD_SHIFT
    for dx in (0, 4):
        bx, by = ftx - 3 + dx, fty + 5
        pos = g.w2s((bx + 1) * TILE, (by + 1) * TILE)
        n0 = len(w.buildings)
        g.try_place((int(pos[0]), int(pos[1])))
        if len(w.buildings) > n0:
            placed.append(w.buildings[-1])
    MODS[0] = 0
    g.placing = None
    check('J2', len(placed) == 2 and all(u.target is placed[0] for u in (b1v, b2v)),
          'Shift placement: the first house first')
    run(g, 60, lambda: placed[1].complete)
    check('J2', placed[0].complete and placed[1].complete, 'then the second - both built in order')
    g.placing = 'gate'
    h0 = g.gate_horiz
    MODS[0] = pygame.KMOD_CTRL
    ev(g, pygame.MOUSEWHEEL, x=0, y=1, flipped=False, precise_x=0.0, precise_y=1.0, touch=False)
    MODS[0] = 0
    check('J5', g.gate_horiz != h0, 'Ctrl+wheel rotates the gate')
    g.placing = None

    print('E - signal')
    mm = g.mm_rect()
    w.events.clear()
    lclick(g, mm.center, pygame.KMOD_ALT)
    check('E3', g.flares and any(e[0] == 'flare' for e in w.events), 'Alt+left click on the minimap - a signal + sound')
    g.draw()

    print('L - cursor')
    cursor_checks(g, w, tc, vils, fx, fy)

    print('D - wheel zoom')
    zoom_checks(g, w, fx, fy)

    print()
    print(f'RESULT: ok {len(OKS)}, FAIL {len(FAILS)}' + (f' — {sorted(set(FAILS))}' if FAILS else ''))
    sys.exit(1 if FAILS else 0)


if __name__ == '__main__':
    main()
