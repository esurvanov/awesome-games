#!/usr/bin/env python3
"""Значки-«картинки» в кадре AoE II DE из наших 3D-моделей (tools/render3d) → assets/ui/portraits/…

  .venv/bin/python tools/build_portraits.py --buildings [--groups anglo,han]
        здания на фоне неба и травы (дом, мельница, замок, башни, стены, ворота, ферма) — по группам архитектуры
        → assets/ui/portraits/scenic/<группа>/<вид>.png
  .venv/bin/python tools/build_portraits.py --orders
        приказы армии: фигурка нашего пехотинца в позах (патруль, охрана, следовать, атака с ходу, стоять),
        требушет свёрнут / развёрнут → assets/ui/portraits/orders/<имя>.png
  .venv/bin/python tools/build_portraits.py --units [--only villager,knight] [--groups caro] [--out DIR] [--install]
        портреты юнитов в кадре DE: ракурс ¾ (смотрит влево), кадр по колено, чёрный фон, синий цвет игрока,
        ключевой свет сверху-слева; модели и правки — из tools/build_units.plan() (те же, что в игре).
        Без --install — только просмотр (DIR, по умолчанию shots/portraits_preview); с --install —
        assets/ui/portraits/units3d/<вид>.<группа юнитов>.png (игра берёт их раньше портретов 0 A.D.).
  --sheet FILE — контактный лист всего собранного.

Камера значка: рендер игры (ортографическая проекция, 30° над землёй) с геометрией, наклонённой к зрителю, —
видимый угол возвышения ELEV_* (DE: здания ≈ 15°, юниты ≈ 8°); свет — зеркальный игровому (сверху-слева).
Производные материалы 0 A.D. / Millennium A.D. © Wildfire Games и авторы мода, CC BY-SA 3.0 (CREDITS.md).
"""
import argparse
import json
import math
import os
import sys
import time
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(REPO, 'assets', 'ui', 'portraits')
SIZE = 128                   # размер значка (как портреты 0 A.D. в assets/ui/portraits)
SS = 2                       # рендер крупнее и уменьшение — мягкие края
ELEV_BLD = 16.0
ELEV_UNIT = 9.0
YAW_UNIT = 72.0            # поворот юнита: ¾, лицом влево-к-зрителю (подобрано по листу)
BLUE = (48, 96, 230)         # цвет игрока на значках DE — всегда синий
# формула перекраски — как в game/sprites3d.recolor (цвет той же яркости, что у текстуры)
TA, TB, TD = 0.40, 0.85, 0.30

# виды зданий-«картинок» (DE: на фоне неба) → (вид атласа build_sprites | особый, доля ширины кадра)
# значок берётся у другой группы: деревянные кольцевые крепости и тёмные бревенчатые «каменные» стены
# западных наборов на значке не читаются как замок / каменная стена (DE: каменный замок, серая стена)
SCENIC_SUB = {('anglo', 'castle'): 'teut', ('celt', 'castle'): 'teut', ('caro', 'castle'): 'teut',
              ('norse', 'castle'): 'teut'}
SCENIC_SUB.update({(g, k): 'teut' for g in ('caro', 'anglo', 'celt') for k in ('stone_wall', 'gate', 'fortified_wall')})
SCENIC = ['house', 'mill', 'castle', 'tower', 'guard_tower', 'keep', 'farm',
          'palisade_wall', 'palisade_gate', 'stone_wall', 'gate', 'fortified_wall']


# ================================================================ камера значка
_R = None


def renderer():
    global _R
    if _R is None:
        from tools.render3d import Renderer
        _R = Renderer(ss=3, shadow_res=2048)
    return _R


def _rot(axis, ang):
    a = np.asarray(axis, np.float64)
    a = a / np.linalg.norm(a)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def icon_items(items, elev, mirror_light=True, spin=0.0):
    """Детали (координаты земли) → те же, наклонённые так, что камера игры видит их под углом elev°.
    mirror_light — отразить по диагонали x=y (после рендера картинку отражают обратно: свет слева)."""
    mesh = [dict(it) for it in items if it['kind'] == 'mesh' and len(it['pos'])]
    P = np.concatenate([it['pos'] for it in mesh]).astype(np.float64)
    c = np.array([(P[:, 0].min() + P[:, 0].max()) / 2, (P[:, 1].min() + P[:, 1].max()) / 2, 0.0])
    R = np.eye(3)
    if isinstance(spin, tuple):
        # ('align', (dx, dy), угол): длинная ось предмета — вдоль экрана, повёрнута на угол к зрителю
        ax = np.array(spin[1], np.float64)
        if mirror_light:
            ax = ax[::-1]
        spin = math.degrees(math.atan2(-1.0, 1.0) - math.atan2(ax[1], ax[0])) + spin[2]
    if spin:
        R = _rot((0, 0, 1), math.radians(spin))
    d = math.radians(30.0 - elev)
    up_to_view = np.array([1.0, 1.0, 0.0])
    T = _rot((1, -1, 0), d)
    if (T @ np.array([0, 0, 1.0])) @ up_to_view > 0:      # верх — от зрителя: видна передняя стена
        T = _rot((1, -1, 0), -d)
    R = T @ R
    out = []
    for it in mesh:
        p = it['pos'].astype(np.float64) - c
        n = it['nrm'].astype(np.float64)
        if mirror_light:
            p = p[:, [1, 0, 2]]
            n = n[:, [1, 0, 2]]
        p = p @ R.T
        n = n @ R.T
        it['pos'] = p.astype(np.float32)
        it['nrm'] = n.astype(np.float32)
        out.append(it)
    zmin = min(float(it['pos'][:, 2].min()) for it in out)
    for it in out:
        it['pos'] = it['pos'] - np.array([0, 0, zmin], np.float32)
        if 'clipz' in it:
            it['clipz'] = 1e9
        it.pop('keep', None)
        it.pop('cut', None)
    return out


def recolor(rgba, mask, color=BLUE):
    """Область маски — цветом игрока той же яркости (как в игре)."""
    rgb = rgba[..., :3].astype(np.float32)
    m = (mask.astype(np.float32) / 255.0)[..., None]
    L = (rgb @ np.array([0.299, 0.587, 0.114], np.float32))[..., None] / 255.0
    c = np.array(color, np.float32)[None, None]
    t = c * (TA + TB * L) + TD * L * 255.0
    out = rgba.copy()
    out[..., :3] = np.clip(rgb * (1 - m) + t * m, 0, 255).astype(np.uint8)
    return out


def shoot(items, elev, look=None, mirror_light=True, spin=0.0, color=BLUE):
    """Рендер значка → RGBA (numpy, обрезан по силуэту), свет сверху-слева, цвет игрока — color."""
    from tools.render3d import Look
    r = renderer()
    its = icon_items(items, elev, mirror_light, spin)
    look = look or Look(sun=(1.45, 1.3, 1.08), amb=(0.62, 0.62, 0.66), saturation=1.15, contrast=1.08)
    spr = r.render(its, footprint=(0, 0), ground=False, shadow_scale=0.0, look=look, pad=3)
    rgba = recolor(spr.rgba, spr.mask, color) if color is not None else spr.rgba
    if mirror_light:
        rgba = rgba[:, ::-1].copy()
    return rgba


def to_img(a):
    return Image.fromarray(np.ascontiguousarray(a), 'RGBA')


# ================================================================ фоны
def sky_grass(size, horizon=0.66, seed=0):
    """Фон «картинных» зданий DE: голубое небо (светлее к горизонту) + полоса травы."""
    rng = np.random.default_rng(seed)
    h = w = size
    y = np.linspace(0, 1, h)[:, None]
    top = np.array([62, 128, 214], np.float32)
    low = np.array([176, 212, 244], np.float32)
    t = np.clip(y / horizon, 0, 1) ** 1.3
    sky = top * (1 - t[..., None]) + low * t[..., None]
    sky = np.broadcast_to(sky, (h, w, 3)).copy()
    # лёгкие облака
    cl = rng.random((h // 8 + 2, w // 8 + 2)).astype(np.float32)
    cl = np.array(Image.fromarray((cl * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)).astype(np.float32) / 255
    cl = np.clip((cl - 0.6) * 2.2, 0, 1) * (1 - t) * 0.45
    sky = sky * (1 - cl[..., None]) + 250 * cl[..., None]
    g0 = np.array([96, 150, 52], np.float32)
    g1 = np.array([60, 110, 34], np.float32)
    gy = np.clip((y - horizon) / (1 - horizon), 0, 1)
    grass = g0 * (1 - gy[..., None]) + g1 * gy[..., None]
    noise = rng.normal(0, 1, (h, w)).astype(np.float32)
    noise = np.array(Image.fromarray(np.clip(noise * 40 + 128, 0, 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 128.0 - 1
    grass = np.broadcast_to(grass, (h, w, 3)) * (1 + 0.16 * noise[..., None])
    hor = int(horizon * h)
    img = sky.copy()
    img[hor:] = grass[hor:]
    # мягкая линия горизонта (дальний лес)
    img[hor - 2:hor + 1] = img[hor - 2:hor + 1] * 0.5 + np.array([70, 110, 60]) * 0.5
    out = np.dstack([np.clip(img, 0, 255), np.full((h, w), 255)]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def black(size):
    return Image.new('RGBA', (size, size), (0, 0, 0, 255))


def fit_on(bg, im, box, anchor='bottom'):
    """Вписать im в прямоугольник box (x0, y0, x1, y1) фона с сохранением пропорций."""
    x0, y0, x1, y1 = box
    k = min((x1 - x0) / im.width, (y1 - y0) / im.height)
    im2 = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    x = round((x0 + x1 - im2.width) / 2)
    y = round(y1 - im2.height) if anchor == 'bottom' else round((y0 + y1 - im2.height) / 2)
    bg.alpha_composite(im2, (x, y))
    return x, y, k


def ground_shadow(bg, cx, y, w, h=None, alpha=110):
    """Мягкая тень-эллипс под предметом на траве."""
    h = h or max(3, w // 6)
    sh = Image.new('L', bg.size, 0)
    ImageDraw.Draw(sh).ellipse((cx - w / 2, y - h / 2, cx + w / 2, y + h / 2), fill=alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(max(1, h / 3)))
    dark = Image.new('RGBA', bg.size, (20, 30, 10, 255))
    dark.putalpha(sh)
    bg.alpha_composite(dark)


# ================================================================ здания на небе
def _bs():
    from tools import build_sprites as B
    return B


def building_render(group, kind, elev=ELEV_BLD):
    """RGBA рендер здания группы (как в игре) под углом значка."""
    B = _bs()
    vs = B.building_variants(group, kind)
    if not vs:
        return None
    actor, pick = vs[0]
    items, parts, place, s, yaw = B.building_items(renderer(), group, kind, actor, pick)
    return shoot(items, elev)


def wall_render(group, piece, elev=ELEV_BLD, n=3):
    """Отрезок стены / ворота набора группы: piece 'stone' | 'palisade' | 'stone_gate' | 'palisade_gate'."""
    B = _bs()
    from tools.render3d import resolve, camera, Renderer, parts_bounds
    wk = 'palisade' if piece.startswith('palisade') else 'stone'
    st = B.WALL_SETS.get(group, B.WALL_SETS['caro'])[wk]
    long_a, tower_a, gate_a = (B._xml(a) for a in B._WS[st])
    s = 1.0 / B.WALL_UPT
    items = []
    if piece.endswith('gate'):
        parts = resolve(gate_a, seed=0, prefer=frozenset({'closed', 'idle'}))
        parts = [p for p in parts if 'garrison_flag' not in p.actor]
        lo, hi = parts_bounds(parts)
        place = camera.placement(s, 0.0, center=(0.0, 0.0), model_center=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
        items = Renderer.build_items(parts, place)
    else:
        parts = resolve(long_a, seed=0)
        lo, hi = parts_bounds(parts)
        place = camera.placement(s, 0.0, center=(0.0, 0.0), model_center=((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2))
        items = Renderer.build_items(parts, place)
        # отрезок длиной n клеток посередине длинной стены
        L = n / 2
        keep = []
        for it in items:
            if it['kind'] != 'mesh':
                continue
            c = it['pos'].reshape(-1, 3, 3).mean(1)
            k = np.abs(c[:, 0]) <= L if (hi[0] - lo[0]) >= (hi[1] - lo[1]) else np.abs(c[:, 1]) <= L
            if not k.any():
                continue
            it = dict(it)
            k3 = np.repeat(k, 3)
            for key in ('pos', 'nrm', 'uv0', 'uv1'):
                it[key] = it[key][k3]
            keep.append(it)
        items = keep
        if piece == 'fortified':
            # укреплённая стена: та же, но с башней посередине
            tp = [p for p in resolve(tower_a, seed=0) if 'garrison_flag' not in p.actor]
            tlo, thi = parts_bounds(tp)
            sp = 1.15 / max(thi[0] - tlo[0], thi[1] - tlo[1])
            pl = camera.placement(sp, 0.0, center=(0.0, 0.0),
                                  model_center=((tlo[0] + thi[0]) / 2, (tlo[1] + thi[1]) / 2))
            items += Renderer.build_items(tp, pl)
    # стена вдоль x в мире — на экране диагональ; поворот на 45°: вдоль экрана, чуть в ракурсе
    P = np.concatenate([it['pos'] for it in items if it['kind'] == 'mesh'])
    ax = (1.0, 0.0) if np.ptp(P[:, 0]) >= np.ptp(P[:, 1]) else (0.0, 1.0)
    return shoot(items, elev, spin=('align', ax, 22.0))


STONE_GREY = {'caro', 'anglo', 'celt', 'teut', 'byz', 'hisp', 'norse', 'rus'}


def palisade_icon(size, gate=False):
    """Частокол DE: ряд заострённых брёвен на фоне неба (ворота — с дощатыми створками посередине)."""
    big = size * SS
    bg = sky_grass(big, horizon=0.7, seed=7 if gate else 5)
    d = ImageDraw.Draw(bg)
    rng = np.random.default_rng(3)
    n = 8
    w = big / (n - 0.4)
    base = big * 0.9
    for i in range(n):
        x = -w * 0.2 + i * w + rng.uniform(-w * 0.05, w * 0.05)
        top = big * (0.08 + rng.uniform(0, 0.1))
        if gate and 3 <= i <= 4:
            continue
        tone = rng.uniform(0.8, 1.1)
        body = tuple(int(c * tone) for c in (150, 110, 66))
        ww = w * 0.9
        tip = top + ww * 1.1                          # заострённый конец бревна
        d.polygon([(x, tip), (x + ww / 2, top), (x + ww, tip), (x + ww, base), (x, base)], fill=body,
                  outline=(60, 40, 20))
        d.polygon([(x + ww * 0.62, top + (tip - top) * 0.25), (x + ww, tip), (x + ww, base), (x + ww * 0.62, base)],
                  fill=tuple(int(c * 0.62) for c in body))
        d.polygon([(x + ww * 0.1, tip - 2), (x + ww / 2, top + 2), (x + ww * 0.62, top + (tip - top) * 0.25)],
                  fill=(222, 196, 140))
        for k in range(3):
            y = top + w + k * (base - top - w) / 3 + rng.uniform(0, w * 0.4)
            d.arc((x + w * 0.2, y, x + w * 0.5, y + w * 0.3), 0, 180, fill=(80, 56, 30), width=max(1, SS))
    d.line([(0, big * 0.42), (big, big * 0.4)], fill=(90, 62, 32), width=int(big * 0.025))
    d.line([(0, big * 0.72), (big, big * 0.7)], fill=(90, 62, 32), width=int(big * 0.025))
    if gate:
        x0, x1 = 3 * w - w * 0.2, 5 * w - w * 0.2
        top = big * 0.12
        d.rectangle((x0 - w * 0.25, top, x0 + w * 0.15, base), fill=(110, 76, 40))
        d.rectangle((x1 - w * 0.15, top, x1 + w * 0.25, base), fill=(110, 76, 40))
        d.rectangle((x0 - w * 0.3, top, x1 + w * 0.3, top + w * 0.35), fill=(126, 88, 48))
        for k in range(5):
            xx = x0 + w * 0.15 + k * (x1 - x0 - w * 0.3) / 5
            d.rectangle((xx, top + w * 0.4, xx + (x1 - x0 - w * 0.3) / 5 - SS, base), fill=(176, 130, 76),
                        outline=(90, 60, 30))
        d.line([((x0 + x1) / 2, top + w * 0.4), ((x0 + x1) / 2, base)], fill=(60, 40, 20), width=2 * SS)
        for yy in (0.4, 0.7):
            d.line([(x0 + w * 0.15, big * yy), (x1 - w * 0.15, big * yy)], fill=(70, 48, 24), width=int(big * 0.02))
    return bg.resize((size, size), Image.LANCZOS)


def farm_icon(size):
    """Ферма DE: поле рядами под небом (процедурно)."""
    bg = sky_grass(size, horizon=0.36, seed=3)
    d = ImageDraw.Draw(bg)
    hor = int(0.36 * size)
    vx, vy = size * 0.5, hor - size * 0.9          # точка схода над горизонтом
    rows = 13
    for i in range(-rows, rows + 1):
        x_bot = size / 2 + i * size * 0.16
        pts = [(vx + (x_bot - vx) * (hor - vy) / (size - vy), hor), (x_bot, size)]
        col = (68, 126, 40) if i % 2 else (132, 104, 56)
        wdt = max(1, int(size * 0.035))
        d.line(pts, fill=col, width=wdt)
    # ряды зелени — светлые пятна
    rng = np.random.default_rng(5)
    for _ in range(int(size * 2.2)):
        x = rng.uniform(0, size)
        y = rng.uniform(hor + 2, size)
        rr = 0.5 + (y - hor) / size * 3.0
        d.ellipse((x - rr, y - rr * 0.7, x + rr, y + rr * 0.7), fill=(88, 160, 50))
    return bg


def scenic_icon(group, kind, size=SIZE):
    """Значок здания DE-«картинки»: наш рендер на фоне неба и травы, здание во весь кадр."""
    big = size * SS
    if kind == 'farm':
        return farm_icon(size)
    if kind in ('palisade_wall', 'palisade_gate'):
        return palisade_icon(size, gate=kind == 'palisade_gate')
    if kind in ('stone_wall', 'gate', 'fortified_wall'):
        piece = {'palisade_wall': 'palisade', 'stone_wall': 'stone', 'palisade_gate': 'palisade_gate',
                 'gate': 'stone_gate', 'fortified_wall': 'fortified'}[kind]
        a = wall_render(group, piece)
        if a is not None and group in STONE_GREY:          # DE: каменная стена — серый камень
            rgb = a[..., :3].astype(np.float32)
            L = (rgb @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]
            a = a.copy()
            a[..., :3] = np.clip(L * 0.72 + rgb * 0.28 + 6, 0, 255).astype(np.uint8)
    else:
        a = building_render(group, kind)
    if a is None:
        return None
    im = to_img(a)
    horizon = 0.68
    bg = sky_grass(big, horizon=horizon, seed=zlib.crc32(f'{group}/{kind}'.encode()) % 97)
    tall = im.height / im.width
    if tall > 1.25:                                   # башни — по высоте
        box = (big * 0.06, big * 0.03, big * 0.94, big * 0.95)
    elif kind in ('palisade_wall', 'stone_wall', 'fortified_wall'):
        box = (-big * 0.08, big * 0.18, big * 1.08, big * 0.92)
    else:
        box = (big * 0.02, big * 0.06, big * 0.98, big * 0.94)
    x0, y0, x1, y1 = box
    k = min((x1 - x0) / im.width, (y1 - y0) / im.height)
    if kind == 'mill':                                # DE: ветряная мельница — дом ниже, крылья над крышей
        box = (big * 0.16, big * 0.36, big * 0.96, big * 0.95)
        x0, y0, x1, y1 = box
        k = min((x1 - x0) / im.width, (y1 - y0) / im.height)
    ground_shadow(bg, (x0 + x1) / 2, y1 - big * 0.02, im.width * k * 0.9, alpha=90)
    x, y, k = fit_on(bg, im, box)
    if kind == 'mill':
        al = np.array(im)[..., 3] > 60
        ys, xs = np.nonzero(al)
        top = ys.min()
        cx = xs[ys <= top + 3].mean()
        windmill_sails(bg, (x + cx * k, y + top * k + big * 0.04), big * 0.42)
    return bg.resize((size, size), Image.LANCZOS)


def windmill_sails(bg, hub, length, angle0=24.0):
    """Крылья ветряной мельницы (4 решётчатых крыла с парусиной) со ступицей в hub — рисуются поверх рендера."""
    lay = Image.new('RGBA', bg.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    hx, hy = hub
    wood, dark, cloth = (120, 84, 46, 255), (58, 38, 20, 255), (236, 228, 206, 255)
    for i in range(4):
        a = math.radians(angle0 + 90 * i)
        ux, uy = math.cos(a) * 0.82, math.sin(a)             # лёгкий ракурс: сжатие по x
        vx, vy = -math.sin(a) * 0.82, math.cos(a)
        w = length * 0.2
        p0 = (hx + ux * length * 0.16, hy + uy * length * 0.16)
        p1 = (hx + ux * length, hy + uy * length)
        quad = [p0, p1, (p1[0] + vx * w, p1[1] + vy * w), (p0[0] + vx * w, p0[1] + vy * w)]
        d.polygon(quad, fill=cloth, outline=dark)
        for t in (0.35, 0.55, 0.75, 0.95):                  # поперечины решётки
            q = (hx + ux * length * t, hy + uy * length * t)
            d.line([q, (q[0] + vx * w, q[1] + vy * w)], fill=wood, width=max(1, int(length * 0.018)))
        d.line([(hx, hy), p1], fill=dark, width=max(2, int(length * 0.04)))
    r = length * 0.07
    d.ellipse((hx - r, hy - r, hx + r, hy + r), fill=(70, 46, 24, 255), outline=(30, 20, 10, 255))
    sh = lay.filter(ImageFilter.GaussianBlur(length * 0.012))
    bg.alpha_composite(lay)
    return sh


def build_scenic(groups, kinds=SCENIC):
    B = _bs()
    t0 = time.time()
    done = {}
    for g0 in groups:
        for kind in kinds:
            g = SCENIC_SUB.get((g0, kind), g0)
            # одинаковые модели в разных группах — один рендер
            if kind == 'farm':
                key = ('farm',)
            elif kind in ('palisade_wall', 'palisade_gate'):
                key = ('pal', B.WALL_SETS.get(g, B.WALL_SETS['caro'])['palisade'], kind)
            elif kind in ('stone_wall', 'gate', 'fortified_wall'):
                key = ('st', B.WALL_SETS.get(g, B.WALL_SETS['caro'])['stone'], kind)
            else:
                vs = B.building_variants(g, kind)
                key = ('b', vs[0][0] if vs else None, kind)
            path = os.path.join(OUT, 'scenic', g0, kind + '.png')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            if key in done:
                done[key].save(path, optimize=True)
                continue
            try:
                im = scenic_icon(g, kind)
            except Exception as e:           # noqa: BLE001 — одна неудачная модель не валит сборку
                print(f'  ! {g}/{kind}: {e}')
                im = None
            if im is None:
                print(f'  - {g}/{kind}: нет модели')
                continue
            im = im.convert('RGB')
            im.save(path, optimize=True)
            done[key] = im
            print(f'  + scenic/{g}/{kind}  {time.time() - t0:.1f} с', flush=True)


# ================================================================ юниты
def _bu():
    from tools import build_units as U
    return U


# вид юнита → как кадрировать: 'inf' (по колено), 'cav' (всадник и перед коня), 'whole' (машина, корабль)
def framing(kind, spec):
    if spec.get('ship') or spec.get('length'):
        return 'whole'
    if spec.get('scale', 0) >= 0.13 or 'cav' in spec.get('actor', '') or 'camel' in spec.get('actor', ''):
        return 'cav'
    return 'inf'


def unit_pose(spec, anim='idle', frac=0.0, yaw=YAW_UNIT, extra_override=None):
    """Детали юнита набора spec (tools/build_units) в позе anim/frac, лицом влево-к-зрителю (¾)."""
    U = _bu()
    from tools.render3d import Renderer, camera, parts_bounds
    from tools.render3d import animactor as aa
    ov = dict(spec.get('override') or {})
    if extra_override:
        ov.update(extra_override)
    skip = (lambda a, ap: 'garrison_flag' in a or 'fish_' in ap) if spec.get('ship') else None
    # одежда (paint), размер инструментов (prop_scale) и доп. детали машин/кораблей (extras) — как в листах
    tree = aa.build(spec['actor'], anim, sel=tuple(spec.get('sel') or ()), seed=spec.get('seed', 0),
                    override=ov or None, skip=skip, paint=spec.get('paint'), prop_scale=spec.get('prop_scale'))
    if tree is None:
        return None
    parts = aa.evaluate(tree, frac) + U.extra_parts(spec)
    scale = (spec.get('scale') or 0.12) * 14.0       # в игре фигура ≈ 21 px; на значок — ≈ 300 px
    if spec.get('length'):
        lo, hi = parts_bounds(parts)
        scale = spec['length'] * 4.0 / max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    # yaw: поворот модели вокруг вертикали (YAW_UNIT — ¾ лицом влево к зрителю после зеркального света)
    place = camera.placement(scale, yaw + U.FWD, center=(0.0, 0.0), mirror=U.MIRROR)
    return Renderer.build_items(parts, place)


def crop_portrait(a, mode, size=SIZE):
    """RGBA рендер → квадрат DE: 'inf' — от макушки до колен, 'cav' — всадник и перед коня, 'whole' — целиком."""
    al = a[..., 3] > 40
    ys, xs = np.nonzero(al)
    if not len(xs):
        return black(size)
    top, bot = ys.min(), ys.max()
    H = bot - top + 1
    if mode == 'inf':
        side = int(H * 0.64)
        y0 = top - int(H * 0.035)
        band = al[top:top + int(H * 0.5)]
    elif mode == 'cav':
        side = int(H * 0.86)
        y0 = top - int(H * 0.03)
        band = al[top:top + int(H * 0.45)]
    else:
        W = xs.max() - xs.min() + 1
        side = int(max(W, H) * 1.02)
        y0 = top - (side - H) // 2
        band = al
    bx = np.nonzero(band.any(0))[0]
    cols = band.sum(0).astype(np.float64)
    cx = (cols * np.arange(len(cols))).sum() / max(1.0, cols.sum()) if mode != 'whole' else (xs.min() + xs.max()) / 2
    if mode != 'whole' and len(bx):
        cx = 0.5 * cx + 0.5 * (bx.min() + bx.max()) / 2
    x0 = int(round(cx - side / 2))
    canvas = np.zeros((side, side, 4), np.uint8)
    canvas[..., 3] = 255
    sy0, sx0 = max(0, y0), max(0, x0)
    sy1, sx1 = min(a.shape[0], y0 + side), min(a.shape[1], x0 + side)
    if sy1 > sy0 and sx1 > sx0:
        src = a[sy0:sy1, sx0:sx1].astype(np.float32)
        dst = canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0].astype(np.float32)
        al2 = src[..., 3:4] / 255.0
        dst[..., :3] = src[..., :3] * al2 + dst[..., :3] * (1 - al2)
        canvas[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = dst.astype(np.uint8)
    im = Image.fromarray(canvas, 'RGBA').convert('RGB')
    return im.resize((size, size), Image.LANCZOS)


def portrait(kind, group=None, size=SIZE, anim='idle', frac=0.0):
    """Портрет вида kind (группа юнитов group) в кадре DE → PIL RGB или None."""
    U = _bu()
    sets, mapping = U.plan()
    mp = mapping.get(kind)
    if not mp:
        return None
    name = mp.get(group) or mp.get('*') or next(iter(mp.values()))
    spec = sets[name]
    mode = framing(kind, spec)
    items = unit_pose(spec, anim, frac, yaw=100.0 if mode == 'whole' else YAW_UNIT)
    if not items:
        return None
    a = shoot(items, 20.0 if mode == 'whole' else ELEV_UNIT)
    return crop_portrait(a, mode, size)


def build_units(only, groups, out, install):
    U = _bu()
    sets, mapping = U.plan()
    kinds = only or sorted(k for k in mapping if not k.startswith('animal_') and k != 'villager_f')
    t0 = time.time()
    for k in kinds:
        mp = mapping.get(k) or {}
        gs = [g for g in (groups or list(mp)) if g in mp] or list(mp)[:1]
        seen = {}
        for g in gs:
            name = mp[g]
            dst_dir = os.path.join(OUT, 'units3d') if install else out
            os.makedirs(dst_dir, exist_ok=True)
            path = os.path.join(dst_dir, f'{k}.{g}.png')
            if name in seen:
                seen[name].save(path, optimize=True)
                continue
            try:
                im = portrait(k, g)
            except Exception as e:           # noqa: BLE001
                print(f'  ! {k}.{g}: {e}')
                continue
            if im is None:
                continue
            im.save(path, optimize=True)
            seen[name] = im
            print(f'  + {k}.{g} ← {name}  {time.time() - t0:.1f} с', flush=True)


# ================================================================ приказы армии
# имя → (вид юнита, анимация, доля цикла, рамка)
# имя → (вид юнита, анимация, доля цикла, поворот): патруль — идёт боком с мечом, охрана — алебардщик
# лицом к зрителю, атака с ходу — замах, стоять — воин анфас со щитом
# фигуры — ¾ влево, как портреты юнитов (YAW_UNIT); 09 · №56: раньше смотрели вправо
ORDERS = {
    'patrol': ('long_swordsman', 'walk', 0.3, YAW_UNIT),
    'guard': ('halberdier', 'idle', 0.0, YAW_UNIT),
    'amove': ('long_swordsman', 'attack_melee', 0.35, YAW_UNIT),
    'stand_ground': ('man_at_arms', 'idle', 0.0, YAW_UNIT),
}


def order_icon(name, size=SIZE):
    U = _bu()
    sets, mapping = U.plan()
    if name in ('treb_packed', 'treb_up'):
        spec = sets[name]
        items = unit_pose(spec, 'idle', 0.0, yaw=100.0)
        a = shoot(items, 20.0)
        return crop_portrait(a, 'whole', size)
    if name == 'follow':
        # двое идут друг за другом + красная стрелка (DE)
        spec = sets[mapping['man_at_arms']['caro']]
        imgs = []
        for fr in (0.1, 0.6):
            items = unit_pose(spec, 'walk', fr, yaw=180.0)
            imgs.append(to_img(shoot(items, ELEV_UNIT)))
        big = size * SS
        bg = black(big)
        h = int(big * 0.8)
        for i, im in enumerate(imgs):
            k = h / im.height
            im2 = im.resize((max(1, int(im.width * k)), h), Image.LANCZOS)
            x = int(big * (0.02 + 0.44 * i))
            bg.alpha_composite(im2, (x, big - h - int(big * 0.04)))
        d = ImageDraw.Draw(bg)
        ay = big * 0.2
        d.polygon([(big * 0.5, ay - big * 0.06), (big * 0.5, ay + big * 0.06), (big * 0.62, ay)], fill=(230, 40, 30))
        d.rectangle((big * 0.3, ay - big * 0.025, big * 0.5, ay + big * 0.025), fill=(230, 40, 30))
        return bg.convert('RGB').resize((size, size), Image.LANCZOS)
    kind, anim, fr, yaw = ORDERS[name]
    spec = sets[mapping[kind]['caro']]
    items = unit_pose(spec, anim, fr, yaw=yaw)
    a = shoot(items, ELEV_UNIT)
    # фигура целиком (DE: воин в полный рост в позе приказа)
    al = a[..., 3] > 40
    ys, xs = np.nonzero(al)
    im = to_img(a).crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    big = size * SS
    bg = black(big)
    fit_on(bg, im, (big * 0.04, big * 0.03, big * 0.96, big * 0.97), anchor='center')
    return bg.convert('RGB').resize((size, size), Image.LANCZOS)


def build_orders(names=None):
    os.makedirs(os.path.join(OUT, 'orders'), exist_ok=True)
    for n in names or (list(ORDERS) + ['follow', 'treb_packed', 'treb_up']):
        im = order_icon(n)
        im.save(os.path.join(OUT, 'orders', n + '.png'), optimize=True)
        print('  + orders/' + n, flush=True)


# ================================================================ лист
def sheet(paths, out, cell=96):
    from PIL import ImageFont
    cols = 10
    rows = (len(paths) + cols - 1) // cols
    sh = Image.new('RGB', (cols * (cell + 6), rows * (cell + 20)), (50, 50, 50))
    d = ImageDraw.Draw(sh)
    try:
        fnt = ImageFont.truetype(os.path.join(REPO, 'assets', 'fonts', 'PTSerif-Regular.ttf'), 11)
    except OSError:
        fnt = None
    for i, p in enumerate(paths):
        x, y = (i % cols) * (cell + 6) + 3, (i // cols) * (cell + 20) + 2
        sh.paste(Image.open(p).convert('RGB').resize((cell, cell), Image.LANCZOS), (x, y))
        d.text((x, y + cell + 2), os.path.relpath(p, OUT)[-22:], fill=(255, 230, 120), font=fnt)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    sh.save(out)
    print('лист:', out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--buildings', action='store_true')
    ap.add_argument('--orders', action='store_true')
    ap.add_argument('--units', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--groups', default='')
    ap.add_argument('--kinds', default='')
    ap.add_argument('--out', default=os.path.join(REPO, 'shots', 'portraits_preview'))
    ap.add_argument('--install', action='store_true')
    ap.add_argument('--sheet', default='')
    a = ap.parse_args()
    only = [s for s in a.only.split(',') if s]
    groups = [s for s in a.groups.split(',') if s]
    made = []
    if a.buildings:
        B = _bs()
        build_scenic(groups or B.GROUPS, [k for k in a.kinds.split(',') if k] or SCENIC)
        made.append(os.path.join(OUT, 'scenic'))
    if a.orders:
        build_orders(only or None)
        made.append(os.path.join(OUT, 'orders'))
    if a.units:
        build_units(only, groups, a.out, a.install)
        made.append(os.path.join(OUT, 'units3d') if a.install else a.out)
    if not made:
        ap.print_help()
        return
    if a.sheet:
        ps = sorted(os.path.join(dp, f) for d in made for dp, _, fs in os.walk(d) for f in fs if f.endswith('.png'))
        sheet(ps, a.sheet)
    with open(os.path.join(OUT, 'portraits3d.json'), 'w') as f:
        json.dump({'size': SIZE, 'elev_building': ELEV_BLD, 'elev_unit': ELEV_UNIT, 'player_color': BLUE}, f)


if __name__ == '__main__':
    main()
