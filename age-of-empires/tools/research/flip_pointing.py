#!/usr/bin/env python3
"""Исследование «перевёрнутое и не туда указывает» (docs/research/09_flipped_and_pointing.md), части C/D/E:
безоконные замеры точности указания — обратимость экран↔земля на равнине и холмах при масштабе 0.7/1.0/1.4,
попадание щелчка по видимым пикселям юнитов/зданий/деревьев/жил (entity_at), маркер и приход юнита по ПКМ,
призрак стройки и клетка стройки, мини-карта (щелчок → центр камеры, ориентация), рамка выделения,
положение полоски здоровья / эллипса выбора относительно спрайта. Ничего в игре не меняет.

  SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy .venv/bin/python tools/research/flip_pointing.py
"""
import json
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))

import numpy as np  # noqa: E402
import pygame  # noqa: E402

from game.data import TILE, SCREEN_W, SCREEN_H, TOP_H, PANEL_H, HH  # noqa: E402
from game import terrain, ui as gui  # noqa: E402
from game.ui import Game  # noqa: E402
from game.world import Unit, Building, Node  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(REPO, 'shots', 'research_flip')
MODS = [0]
RESULT = {}
ZOOMS = (0.7, 1.0, 1.4)


def out(key, val):
    print(f'{key:<46} {val}')
    RESULT[key] = val


def ev(g, typ, **kw):
    g.on_event(pygame.event.Event(typ, **kw))


def reveal(w):
    w.vis = bytearray(b'\x01' * (w.W * w.H))
    w.explored = bytearray(b'\x01' * (w.W * w.H))
    w.amat[0] = [True] * len(w.amat[0])
    for b in w.buildings:
        b.seen = True
    w.fog_version += 1


def run(g, sec, dt=0.034):
    w = g.world
    for _ in range(int(sec / dt)):
        w.update(dt)
        w.events.clear()


def in_view(g, sx, sy):
    return 0 <= sx < SCREEN_W and TOP_H + 4 <= sy < SCREEN_H - PANEL_H - 4


def c2s(g, cx, cy):
    """Холст → экран (обратно к Game.to_canvas)."""
    z = g.zoom
    return cx * z, TOP_H + (cy - TOP_H) * z


def hilliest(w, n=1):
    """Клетки с самым крутым рельефом (по перепаду вершин) и самые ровные."""
    hz = np.array(w.hz, np.float64)
    g = np.abs(hz[1:, 1:] - hz[:-1, :-1]) + np.abs(hz[1:, :-1] - hz[:-1, 1:])
    g[:6, :] = g[-6:, :] = g[:, :6] = g[:, -6:] = -1
    order = np.argsort(g.ravel())[::-1]
    steep = [(int(i % w.W), int(i // w.W), float(g.ravel()[i])) for i in order[:n]]
    return steep


def flat_spot(w, tc):
    """Ровная клетка недалеко от центра — суша."""
    cx, cy = tc.center()
    for r in range(4, 30):
        for _ in range(60):
            tx = int(cx // TILE) + random.randint(-r, r)
            ty = int(cy // TILE) + random.randint(-r, r)
            if 2 <= tx < w.W - 2 and 2 <= ty < w.H - 2 and w.passable(tx, ty) and w.floor[ty][tx] is None:
                z = [w.hz[ty + j][tx + i] for i in (0, 1) for j in (0, 1)]
                if max(z) - min(z) < 0.5:
                    return tx, ty
    return int(cx // TILE) + 5, int(cy // TILE) + 5


# ============================================================ 1. обратимость экран → земля → экран
def t_roundtrip(g, spots):
    w = g.world
    rows = []
    for name, (tx, ty) in spots:
        for z in ZOOMS:
            g.set_zoom(z)
            g.center_on((tx + 0.5) * TILE, (ty + 0.5) * TILE)
            errs, hs = [], []
            for _ in range(400):
                sx = random.uniform(SCREEN_W * 0.2, SCREEN_W * 0.8)
                sy = random.uniform(TOP_H + 60, SCREEN_H - PANEL_H - 60)
                wx, wy = g.s2w(sx, sy)
                bx, by = g.w2s(wx, wy)
                errs.append(math.hypot(bx - sx, by - sy))
                hs.append(w.z_at(wx, wy))
            e = np.array(errs)
            rows.append((name, z, float(e.mean()), float(e.max()), float(np.max(np.abs(hs))),
                         float(np.corrcoef(e, np.abs(hs))[0, 1]) if np.std(hs) > 0 else 0.0))
            out(f'roundtrip {name} zoom {z}',
                f'mean {e.mean():.2f} px  max {e.max():.2f} px  |h|max {max(map(abs, hs)):.0f} px  '
                f'corr(err,|h|) {rows[-1][5]:+.2f}')
    return rows


# ============================================================ 2. холст при масштабе: растяжение и целая камера
def t_canvas_scale(g):
    for z in (0.6, 0.7, 0.8, 1.2, 1.4, 1.6):
        cw = int(math.ceil(SCREEN_W / z))
        ch = int(math.ceil((SCREEN_H - TOP_H) / z))
        ex = SCREEN_W - cw * z              # сдвиг правого края холста относительно w2s (px экрана)
        ey = (SCREEN_H - TOP_H) - ch * z
        out(f'canvas stretch zoom {z}', f'растяжение {SCREEN_W / cw:.4f} vs {z}: ошибка у правого края {ex:+.2f} px, '
                                        f'у низа {ey:+.2f} px')
    out('terrain int(cam) vs objects float', 'земля рисуется со сдвигом int(cam_x), int(cam_y) (ui.py:1268), '
                                             'объекты — с дробным: до 1 px холста (× zoom на экране)')


# ============================================================ 3. щелчок по видимым пикселям
def body_pixels(spr, ax, ay, thr=128):
    a = pygame.surfarray.pixels_alpha(spr)          # (w, h)
    ys, xs = np.nonzero(a.T >= thr)
    del a
    return xs - ax, ys - ay


def t_click_units(g, units, label):
    """Доля пикселей тела, по которым щелчок выбирает юнита; ложные срабатывания — в рамке вокруг тела."""
    w = g.world
    res = []
    for z in ZOOMS:
        g.set_zoom(z)
        for u in units:
            g.center_on(u.x, u.y)
            g.draw()
            us = gui._uset(u, g.civ_of(u.owner))
            if us is None:
                continue
            name, k = gui.unit_pose(u, us, w.time, False)
            spr, ax, ay = us.frame(us.index(name, us.face(*u.face), k), g.pcolor(u.owner))
            cx, cy = g.w2c(u.x, u.y)
            xs, ys = body_pixels(spr, ax, ay)
            if len(xs) > 500:
                sel = random.sample(range(len(xs)), 500)
                xs, ys = xs[sel], ys[sel]
            hit = 0
            for dx, dy in zip(xs, ys):
                sx, sy = c2s(g, cx + dx + 0.5, cy + dy + 0.5)
                if g.entity_at((sx, sy)) is u:
                    hit += 1
            # ложные: пиксели в рамке тела + 6 px, где тела нет
            x0, x1, y0, y1 = xs.min() - 6, xs.max() + 6, ys.min() - 6, ys.max() + 6
            body = set(zip(xs.tolist(), ys.tolist()))
            fp = tot = 0
            for _ in range(300):
                dx, dy = random.randint(x0, x1), random.randint(y0, y1)
                if (dx, dy) in body:
                    continue
                tot += 1
                sx, sy = c2s(g, cx + dx + 0.5, cy + dy + 0.5)
                if g.entity_at((sx, sy)) is u:
                    fp += 1
            res.append((u.kind, z, hit / len(xs), fp / max(1, tot), int(ys.min()), int(ys.max()), us.bh))
            out(f'click {label} {u.kind} zoom {z}',
                f'попал по телу {100 * hit / len(xs):.0f} %  ложно вокруг {100 * fp / max(1, tot):.0f} %  '
                f'тело y {ys.min()}..{ys.max()} (bh {us.bh})')
    return res


def t_click_sprites(g, ents, label):
    """Здания, деревья, жилы: доля непрозрачных пикселей спрайта, по которым entity_at возвращает объект."""
    w = g.world
    res = []
    for z in ZOOMS:
        g.set_zoom(z)
        for e in ents:
            if isinstance(e, Building):
                cxw, cyw = e.center()
            else:
                cxw, cyw = (e.tx + 0.5) * TILE, (e.ty + 0.5) * TILE
            g.center_on(cxw, cyw)
            g.draw()
            rec = next((d for d in g.drawn if d[1] is e), None)
            if rec is None:
                out(f'click {label} {e.kind} zoom {z}', 'спрайт не нарисован (нет в g.drawn)')
                continue
            rect, _, surf = rec
            a = pygame.surfarray.pixels_alpha(surf)
            ys, xs = np.nonzero(a.T > 120)
            del a
            if len(xs) > 400:
                sel = random.sample(range(len(xs)), 400)
                xs, ys = xs[sel], ys[sel]
            hit = 0
            for dx, dy in zip(xs, ys):
                sx, sy = c2s(g, rect.x + dx + 0.5, rect.y + dy + 0.5)
                if not in_view(g, sx, sy):
                    continue
                if g.entity_at((sx, sy)) is e:
                    hit += 1
            res.append((e.kind, z, hit / len(xs)))
            out(f'click {label} {e.kind} zoom {z}', f'попал по спрайту {100 * hit / len(xs):.0f} %')
    return res


# ============================================================ 4. ПКМ: маркер и приход
def t_move(g, u, spots):
    w = g.world
    res = []
    for name, (tx, ty) in spots:
        for z in ZOOMS:
            g.set_zoom(z)
            g.center_on((tx + 0.5) * TILE, (ty + 0.5) * TILE)
            errs_m, errs_a = [], []
            for _ in range(8):
                u.x, u.y = (tx + 0.5) * TILE + random.uniform(-3, 3) * TILE, (ty + 0.5) * TILE + random.uniform(-3, 3) * TILE
                u.path, u.dest, u.state = [], None, 'idle'
                g.selected = [u]
                sx = random.uniform(SCREEN_W * 0.3, SCREEN_W * 0.7)
                sy = random.uniform(TOP_H + 100, SCREEN_H - PANEL_H - 100)
                g.markers = []
                wx, wy = g.s2w(sx, sy)
                if not w.passable_px(wx, wy, 0):
                    continue
                ev(g, pygame.MOUSEBUTTONDOWN, pos=(sx, sy), button=3)
                ev(g, pygame.MOUSEBUTTONUP, pos=(sx, sy), button=3)
                if g.markers:
                    mx, my = g.w2s(g.markers[-1][0], g.markers[-1][1])
                    errs_m.append(math.hypot(mx - sx, my - sy))
                run(g, 25)
                ax, ay = g.w2s(u.x, u.y)
                errs_a.append(math.hypot(ax - sx, ay - sy))
            m = np.array(errs_m) if errs_m else np.zeros(1)
            a = np.array(errs_a) if errs_a else np.zeros(1)
            res.append((name, z, float(m.mean()), float(m.max()), float(a.mean()), float(a.max())))
            out(f'rclick {name} zoom {z}', f'маркер: mean {m.mean():.2f} max {m.max():.2f} px;  '
                                          f'приход юнита: mean {a.mean():.1f} max {a.max():.1f} px (n={len(errs_a)})')
    return res


# ============================================================ 5. призрак стройки и клетка стройки
def t_place(g, spot):
    w = g.world
    tx0, ty0 = spot
    res = []
    for kind in ('house', 'barracks', 'town_center'):
        s = gui.BUILDINGS[kind]['size']
        for z in ZOOMS:
            g.set_zoom(z)
            g.center_on((tx0 + 0.5) * TILE, (ty0 + 0.5) * TILE)
            g.placing = kind
            same = 0
            offs = []
            n = 40
            for _ in range(n):
                mp = (random.uniform(300, 980), random.uniform(TOP_H + 100, SCREEN_H - PANEL_H - 100))
                t_screen = g.place_tile(mp)                     # try_place: экранные координаты
                g._cv = True
                t_ghost = g.place_tile(g.to_canvas(mp))        # draw_ghost: координаты холста
                g._cv = False
                same += t_screen == t_ghost
                # центр основания на экране vs курсор
                tx, ty = t_screen
                cx, cy = g.w2s((tx + s / 2) * TILE, (ty + s / 2) * TILE, terrain.footprint_z(w, tx, ty, s, s))
                offs.append((cx - mp[0], cy - mp[1]))
            g.placing = None
            o = np.array(offs)
            d = np.hypot(o[:, 0], o[:, 1])
            res.append((kind, z, same / n, float(d.mean()), float(d.max())))
            out(f'place {kind} zoom {z}', f'призрак = стройка {100 * same / n:.0f} %;  центр основания − курсор: '
                                         f'mean {d.mean():.1f} max {d.max():.1f} px (клетка {TILE * z:.0f}×{HH * 2 * z:.0f})')
    return res


# ============================================================ 6. мини-карта
def t_minimap(g, tc):
    w = g.world
    r = g.mm_rect()
    errs = []
    for z in ZOOMS:
        g.set_zoom(z)
        for _ in range(60):
            # случайная точка внутри ромба мини-карты
            while True:
                p = (random.uniform(r.left, r.right), random.uniform(r.top, r.bottom))
                if g.mm_hit(p):
                    break
            g.minimap_jump(p)
            # центр окна мира → земля → мини-карта
            cx, cy = SCREEN_W / 2, TOP_H + (SCREEN_H - TOP_H - PANEL_H) / 2
            wx, wy = g.s2w(cx, cy)
            mx, my = g.world_to_mm(wx, wy)
            # без учёта прижатия камеры к краю карты
            if 0 < g.cam_x < g.iso_tw - g.view_w() - 1 and 0 < g.cam_y < g.iso_th - g.view_h() - 1:
                errs.append((mx - p[0], my - p[1], w.z_at(wx, wy)))
    e = np.array(errs)
    d = np.hypot(e[:, 0], e[:, 1])
    out('minimap jump → centre', f'ошибка mean {d.mean():.2f} max {d.max():.2f} px мини-карты '
                                 f'(≈ {d.mean() * g.iso_tw / r.w / TILE:.2f} клетки); dy среднее {e[:, 1].mean():+.2f}; '
                                 f'corr(dy, h) {np.corrcoef(e[:, 1], e[:, 2])[0, 1]:+.2f}  (ромб {r.w}×{r.h})')
    # ориентация: пятно цвета игрока (ЦГ) на картинке мини-карты vs world_to_mm(ЦГ)
    g.set_zoom(1.0)
    g.mm_img = None
    g.draw()
    img = g.mm_img
    arr = pygame.surfarray.array3d(img).transpose(1, 0, 2).astype(int)
    col = np.array(g.mm_color(0))
    m = (np.abs(arr - col).sum(2) < 60)
    ys, xs = np.nonzero(m)
    # кластер ближе к ЦГ: берём все пиксели и медиану — здания игрока рядом с ЦГ
    bx, by = g.world_to_mm(*tc.center())
    if len(xs):
        px, py = r.left + np.median(xs), r.top + np.median(ys)
        out('minimap orientation (TC blob vs world_to_mm)',
            f'пятно ({px:.0f}, {py:.0f}) vs ЦГ ({bx:.0f}, {by:.0f}) → расхождение {math.hypot(px - bx, py - by):.1f} px; '
            f'зеркало по x дало бы {abs(2 * r.centerx - bx - px):.0f} px, по y — {abs(2 * r.centery - by - py):.0f} px')
    else:
        out('minimap orientation', 'цвет игрока на мини-карте не найден')
    return d


# ============================================================ 7. рамка выделения
def t_box(g, units, spot):
    w = g.world
    tx, ty = spot
    g.set_zoom(1.0)
    g.center_on((tx + 0.5) * TILE, (ty + 0.5) * TILE)
    u = units[0]
    u.x, u.y = (tx + 0.5) * TILE, (ty + 0.5) * TILE
    us = gui._uset(u, g.civ_of(0))
    sx, sy = g.w2s(u.x, u.y)
    # рамка только вокруг головы (ноги снаружи)
    g.selected = []
    ev(g, pygame.MOUSEBUTTONDOWN, pos=(sx - 20, sy - us.bh - 10), button=1)
    ev(g, pygame.MOUSEBUTTONUP, pos=(sx + 20, sy - us.bh * 0.5), button=1)
    head = u in g.selected
    g.selected = []
    ev(g, pygame.MOUSEBUTTONDOWN, pos=(sx - 20, sy - 4), button=1)
    ev(g, pygame.MOUSEBUTTONUP, pos=(sx + 20, sy + 20), button=1)
    feet = u in g.selected
    out('box select: only head in box / only feet in box', f'{head} / {feet}  (controls.py:165: точка ног − 8 px, +12 px запас)')


# ============================================================ 8. эллипс выбора, полоска здоровья, значок группы
def t_overlays(g, units):
    w = g.world
    rows = []
    for u in units:
        us = gui._uset(u, g.civ_of(0))
        name, k = gui.unit_pose(u, us, w.time, False)
        spr, ax, ay = us.frame(us.index(name, us.face(*u.face), k), g.pcolor(0))
        xs, ys = body_pixels(spr, ax, ay)
        rw = u.radius * 2.4 + 8
        top = ys.min()
        rows.append((u.kind, int(top), us.bh, us.h, rw, int(xs.min()), int(xs.max())))
        out(f'overlay {u.kind}', f'макушка спрайта {top:+d} px, полоска на −{us.bh + 7} (bh {us.bh}, h {us.h}); '
                                f'эллипс {rw:.0f}×{rw / 2:.0f} vs тело x {xs.min():+d}..{xs.max():+d}')
    return rows


def main():
    random.seed(7)
    os.makedirs(OUT, exist_ok=True)
    g = Game()
    g.mods = lambda: MODS[0]
    g.new_game(1, opponents=1, map_type='land', civ='franks')
    w = g.world
    w.ais = []
    reveal(w)
    tc = next(b for b in w.buildings if b.owner == 0 and b.kind == 'town_center')
    for u in list(w.units):
        if u.owner == 0:
            w.units.remove(u)
    flat = flat_spot(w, tc)
    steep = hilliest(w, 1)[0]
    hill = (steep[0], steep[1])
    out('map', f'{w.W}×{w.H}, relief={bool(w.relief)}, ровно {flat}, холм {hill} (перепад {steep[2]:.0f} px)')
    spots = [('flat', flat), ('hill', hill)]

    t_roundtrip(g, spots)
    t_canvas_scale(g)

    # юниты для щелчков: на равнине и на холме
    kinds = ('villager', 'spearman', 'knight', 'trebuchet', 'monk')
    units = []
    for i, k in enumerate(kinds):
        u = Unit(k, 0, (flat[0] + 0.5) * TILE + i * 3 * TILE, (flat[1] + 0.5) * TILE, w)
        u.face = (math.cos(i * 0.9), math.sin(i * 0.9))
        w.units.append(u)
        units.append(u)
    t_click_units(g, units, 'flat')
    hu = []
    for i, k in enumerate(('villager', 'knight')):
        u = Unit(k, 0, (hill[0] + 0.5) * TILE + i * TILE, (hill[1] + 0.5) * TILE, w)
        w.units.append(u)
        hu.append(u)
    t_click_units(g, hu, 'hill')
    for u in hu:
        w.units.remove(u)

    # здания, деревья, жилы (одиночные, недалеко от ЦГ)
    ents = [tc]
    for kind in ('house', 'barracks', 'mill'):
        b = next((b for b in w.buildings if b.owner == 0 and b.kind == kind), None)
        if b:
            ents.append(b)
    cx, cy = tc.center()
    trees = sorted((n for n in w.nodes if n.kind == 'tree' and n.alive), key=lambda n: (n.tx * TILE - cx) ** 2 + (n.ty * TILE - cy) ** 2)
    # одиночное дерево — без соседей-деревьев спереди
    occ = {(n.tx, n.ty) for n in w.nodes if n.kind == 'tree' and n.alive}
    lone = [n for n in trees if not any((n.tx + i, n.ty + j) in occ for i in (0, 1, 2) for j in (0, 1, 2) if (i, j) != (0, 0))]
    if lone:
        ents.append(lone[0])
    ents.append(trees[len(trees) // 2])       # дерево в лесу (могут заслонять соседи спереди)
    for kind in ('gold', 'stone', 'berries'):
        n = min((n for n in w.nodes if n.kind == kind and n.alive), key=lambda n: (n.tx * TILE - cx) ** 2 + (n.ty * TILE - cy) ** 2, default=None)
        if n:
            ents.append(n)
    t_click_sprites(g, ents, 'sprite')

    t_move(g, units[1], spots)
    t_place(g, flat)
    t_minimap(g, tc)
    t_box(g, units, flat)
    t_overlays(g, units)

    with open(os.path.join(OUT, 'pointing.json'), 'w', encoding='utf-8') as f:
        json.dump(RESULT, f, ensure_ascii=False, indent=1)
    pygame.quit()


if __name__ == '__main__':
    main()
