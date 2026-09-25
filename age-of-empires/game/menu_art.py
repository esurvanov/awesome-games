"""Illustrations of the main menu tiles and the "Single Player" window - from the game's own sprites (0 A.D. / Millennium A.D.,
CC BY-SA), toned "ink sepia" on parchment, like DE's sketches (their art is Microsoft's property, we do not take it).

  tile_art(kind, (w, h)) -> Surface     kind: 'single' | 'multi' | 'learn' | 'skirmish' | 'campaign' |
                                                'scenario' | 'load'
"""
import random

import pygame

from . import sprites3d, gfx, uiskin as S

_cache = {}
INK_TINT = (250, 222, 168)
BLUE, RED = (60, 90, 170), (170, 50, 40)


def _zoom(spr, k):
    """Uniform scaling with smoothing (rotozoom: smoothscale gives stripes on frames from sheets)."""
    return pygame.transform.rotozoom(spr.copy(), 0, k)


def _unit(kind, civ, d, anim='idle', k=0, color=BLUE, scale=1.0):
    us = sprites3d.unit_set(kind, civ) if sprites3d.units_index() is not None else None
    if us is not None and anim in us.anims:
        try:
            spr, ax, ay = us.frame(us.index(anim, d, k), color)
            if scale != 1.0:
                spr = _zoom(spr, scale)
                ax, ay = int(ax * scale), int(ay * scale)
            return spr, ax, ay
        except Exception:
            pass
    surf = pygame.Surface((60, 70), pygame.SRCALPHA)
    gfx.draw_unit(surf, kind, color, 30, 62, (1 if d in (0, 1, 7) else -1, 0.3), 0.0, 0.0, 1.6 * scale)
    return surf, 30, 62


def _building(kind, civ, color=BLUE, scale=1.0):
    r = sprites3d.building(kind, civ, color) if sprites3d.available() else None
    if r is None:
        spr, ox, oy = gfx.make_building_sprite(kind, color)
    else:
        spr, ox, oy = r
    if scale != 1.0:
        spr = _zoom(spr, scale)
        ox, oy = int(ox * scale), int(oy * scale)
    return spr, ox, oy


def _paper(size):
    """A clean sheet: the middle of the parchment texture (without torn edges), stretched to the tile."""
    src = S.image('skin/parchment.png')
    if src is None:
        base = pygame.Surface(size)
        base.fill((226, 204, 160))
        return base
    w, h = src.get_size()
    crop = src.subsurface((w // 4, h // 4, w // 2, h // 2))
    base = pygame.Surface(size)
    base.blit(pygame.transform.smoothscale(crop, size), (0, 0))
    return base


def _ink(surf):
    """A color picture -> sepia (grey x the parchment tone)."""
    try:
        import numpy as np
        g = surf.copy()
        rgb = pygame.surfarray.pixels3d(g)
        lum = rgb[..., 0] * 0.3 + rgb[..., 1] * 0.59 + rgb[..., 2] * 0.11
        lum = np.clip((lum - 25) * 1.6, 0, 255)                     # contrast: shadows darker, lights brighter
        for i, t in enumerate(INK_TINT):
            rgb[..., i] = (lum * (t / 255.0)).astype(np.uint8)
        del rgb
        return g
    except ImportError:
        g = pygame.transform.grayscale(surf)
        g.fill(INK_TINT, special_flags=pygame.BLEND_RGB_MULT)
        return g


def _scene(kind, size):
    w, h = size
    canvas = pygame.Surface((w * 2, h * 2), pygame.SRCALPHA)
    W2, H2 = w * 2, h * 2
    rnd = random.Random(kind)

    def put(item, x, y):
        spr, ax, ay = item
        canvas.blit(spr, (int(x) - ax, int(y) - ay))

    if kind in ('single', 'campaign'):
        spr = _building("castle", "britons", BLUE, 1.0)
        put((spr[0], spr[1] + spr[0].get_width() // 2 - spr[1], spr[2]), W2 * 0.62, H2 * 0.30)
        for i in range(3):
            put(_unit('knight', 'franks', 3, 'idle', 0, BLUE, 1.5), W2 * (0.12 + i * 0.13), H2 * (0.78 + (i % 2) * 0.1))
        put(_unit('archer', 'britons', 3, 'idle', 0, BLUE, 1.4), W2 * 0.5, H2 * 0.92)
    elif kind in ('multi', 'skirmish'):
        for row in range(2):
            for i in range(5):
                side = i < 2
                kindu = ('knight', 'spearman', 'militia', 'archer', 'militia')[(i + row) % 5]
                d = 0 if side else 4
                col = BLUE if side else RED
                x = W2 * (0.12 + i * 0.19) + rnd.uniform(-8, 8)
                y = H2 * (0.55 + row * 0.3) + rnd.uniform(-6, 6)
                put(_unit(kindu, 'teutons' if side else 'mongols', d, 'attack', 3, col, 1.45), x, y)
    elif kind == 'learn':
        spr = _building('house', 'franks', BLUE, 1.0)
        put((spr[0], spr[1] + spr[0].get_width() // 2 - spr[1], spr[2]), W2 * 0.64, H2 * 0.34)
        for i, (anim, d) in enumerate((('build', 1), ('idle', 3), ('build', 7))):
            put(_unit('villager', 'franks', d, anim, 2, BLUE, 1.6), W2 * (0.18 + i * 0.16), H2 * (0.68 + (i % 2) * 0.18))
    elif kind == 'scenario':
        spr = _building('town_center', 'teutons', BLUE, 0.6)
        put((spr[0], spr[1] + spr[0].get_width() // 2 - spr[1], spr[2]), W2 * 0.5, H2 * 0.2)
    elif kind == 'load':
        spr = _building('monastery', 'byzantines', BLUE, 0.7)
        put((spr[0], spr[1] + spr[0].get_width() // 2 - spr[1], spr[2]), W2 * 0.5, H2 * 0.24)
        put(_unit('monk', 'byzantines', 2, 'idle', 0, BLUE, 1.5), W2 * 0.2, H2 * 0.85)
    bb = canvas.get_bounding_rect()
    if bb.w == 0:
        return None
    fig = canvas.subsurface(bb).copy()
    k = min((w - 12) / bb.w, (h - 10) / bb.h)
    fig = _zoom(fig, k)
    return fig


def tile_art(kind, size):
    key = (kind, size)
    got = _cache.get(key)
    if got is not None:
        return got
    out = _paper(size)
    try:
        fig = _scene(kind, size)
    except Exception:
        fig = None
    if fig is not None:
        fig = _ink(fig)
        out.blit(fig, fig.get_rect(midbottom=(size[0] // 2, size[1] - 2)))
    # a soft vignette at the edges - a "drawing on a sheet"
    v = pygame.Surface(size, pygame.SRCALPHA)
    for i in range(10):
        pygame.draw.rect(v, (90, 60, 20, int(60 * (1 - i / 10))), (i, i, size[0] - 2 * i, size[1] - 2 * i), 1)
    out.blit(v, (0, 0))
    _cache[key] = out
    return out
