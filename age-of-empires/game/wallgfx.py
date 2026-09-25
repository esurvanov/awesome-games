"""Procedural wall and gate graphics: segments connect to their neighbors (the defense.wall_mask mask).

A palisade - pointed logs; a stone wall - blocks with battlements; a gate - two towers and leaves
(open when own units are nearby). Sprites are cached by (kind, color, mask / orientation, open).
They return (surface, ox, oy): (ox, oy) is the top corner of the base diamond inside the sprite.
"""
import math

import pygame

from .data import BUILDINGS, HW, HH, shade
from .defense import DIR8
from . import sprites3d

_cache = {}

LOG = (146, 102, 58)
LOG_TIP = (196, 160, 112)
STONE = (178, 172, 160)
WOOD_DOOR = (122, 84, 50)

EXTRA = 74          # a height margin above the cell's diamond


def is_palisade(kind):
    return kind.startswith('palisade')


def _canvas(w, h, extra=EXTRA):
    W = (w + h) * HW + 8
    Hh = (w + h) * HH + extra + 4
    surf = pygame.Surface((W, Hh), pygame.SRCALPHA)
    return surf, h * HW + 4, extra


class _P:
    """A mini-painter: cell coordinates (x, y) and height z in pixels."""

    def __init__(self, surf, ox, oy):
        self.s = surf
        self.ox, self.oy = ox, oy

    def P(self, x, y, z=0.0):
        return (self.ox + (x - y) * HW, self.oy + (x + y) * HH - z)

    def poly(self, pts, color, outline=True):
        sp = [self.P(*p) for p in pts]
        pygame.draw.polygon(self.s, color, sp)
        if outline:
            pygame.draw.polygon(self.s, shade(color, -60), sp, 1)

    def box(self, x0, y0, x1, y1, h, color, z0=0.0, top=True, mortar=False):
        rc = shade(color, -38)
        self.poly([(x0, y1, z0), (x1, y1, z0), (x1, y1, z0 + h), (x0, y1, z0 + h)], color)
        self.poly([(x1, y1, z0), (x1, y0, z0), (x1, y0, z0 + h), (x1, y1, z0 + h)], rc)
        if mortar:
            for z in range(int(z0) + 7, int(z0 + h) - 2, 7):
                pygame.draw.line(self.s, shade(color, -24), self.P(x0, y1, z), self.P(x1, y1, z))
                pygame.draw.line(self.s, shade(rc, -24), self.P(x1, y1, z), self.P(x1, y0, z))
        if top:
            self.poly([(x0, y0, z0 + h), (x1, y0, z0 + h), (x1, y1, z0 + h), (x0, y1, z0 + h)], shade(color, 22))


# ============================================================ palisade
def _log(p, x, y, h, r, band=None):
    bx, by = p.P(x, y, 0)
    top = by - h
    s = p.s
    pygame.draw.polygon(s, LOG, [(bx - r, by), (bx, by + 1), (bx, top + 1), (bx - r, top)])
    pygame.draw.polygon(s, shade(LOG, -42), [(bx, by + 1), (bx + r, by), (bx + r, top), (bx, top + 1)])
    pygame.draw.polygon(s, LOG_TIP, [(bx - r, top), (bx, top + 1), (bx + r, top), (bx, top - r * 1.9)])
    pygame.draw.line(s, shade(LOG, -75), (bx - r, by), (bx - r, top), 1)
    pygame.draw.line(s, shade(LOG, -85), (bx + r, by), (bx + r, top), 1)
    if band:
        pygame.draw.line(s, band, (bx - r + 1, top + 7), (bx + r - 1, top + 7), 2)


def _palisade_piece(p, mask, color):
    logs = [(0.5, 0.5, 29, 4.5)]
    for i, (dx, dy) in enumerate(DIR8):
        if not mask & (1 << i):
            continue
        L = 0.5 * math.hypot(dx, dy)
        n = max(2, int(round(L / 0.13)))
        for k in range(1, n + 1):
            t = 0.5 * k / n
            h = 24 + ((k * 5 + i) % 3) * 2
            logs.append((0.5 + dx * t, 0.5 + dy * t, h, 3.6))
    if not mask:
        logs += [(0.3, 0.5, 25, 3.6), (0.7, 0.5, 26, 3.6), (0.5, 0.3, 24, 3.6), (0.5, 0.7, 25, 3.6)]
    logs.sort(key=lambda l: (l[0] + l[1], l[0] - l[1]))
    for x, y, h, r in logs:
        _log(p, x, y, h, r, color)


# ============================================================ stone
def _slab(p, ax, ay, bx, by, t, H, color, band):
    ux, uy = bx - ax, by - ay
    L = math.hypot(ux, uy)
    if L < 1e-6:
        return
    ux, uy = ux / L, uy / L
    nx, ny = -uy, ux
    a1 = (ax + nx * t / 2, ay + ny * t / 2)
    b1 = (bx + nx * t / 2, by + ny * t / 2)
    a2 = (ax - nx * t / 2, ay - ny * t / 2)
    b2 = (bx - nx * t / 2, by - ny * t / 2)

    def lit(fx, fy):
        px, py = max(0.0, fx), max(0.0, fy)
        return shade(color, int(-38 * px / (px + py + 1e-9)))

    faces = []
    for (c, d, fx, fy) in ((a1, b1, nx, ny), (a2, b2, -nx, -ny)):
        if fx + fy > 1e-6:
            faces.append((c, d, fx, fy))
    for c, d, fx, fy in faces:
        col = lit(fx, fy)
        p.poly([(c[0], c[1], 0), (d[0], d[1], 0), (d[0], d[1], H), (c[0], c[1], H)], col)
        for z in range(7, H - 2, 7):
            pygame.draw.line(p.s, shade(col, -22), p.P(c[0], c[1], z), p.P(d[0], d[1], z))
        # staggered vertical seams
        n = max(1, int(L / 0.22))
        for k in range(1, n):
            f = k / n
            x = c[0] + (d[0] - c[0]) * f
            y = c[1] + (d[1] - c[1]) * f
            z0 = 7 * (k % 2)
            for z in range(z0, H - 7, 14):
                pygame.draw.line(p.s, shade(col, -22), p.P(x, y, z), p.P(x, y, z + 7))
        if band:
            pygame.draw.line(p.s, band, p.P(c[0], c[1], H - 3), p.P(d[0], d[1], H - 3), 2)
    if ux + uy > 1e-6:
        col = lit(ux, uy)
        p.poly([(b1[0], b1[1], 0), (b2[0], b2[1], 0), (b2[0], b2[1], H), (b1[0], b1[1], H)], col)
    p.poly([(a1[0], a1[1], H), (b1[0], b1[1], H), (b2[0], b2[1], H), (a2[0], a2[1], H)], shade(color, 20))
    # battlements
    n = max(1, int(round(L / 0.25)))
    sz = 0.13
    for k in range(n):
        f = (k + 0.5) / n
        x, y = ax + (bx - ax) * f, ay + (by - ay) * f
        if k % 2 == 0:
            p.box(x - sz / 2, y - sz / 2, x + sz / 2, y + sz / 2, 6, color, z0=H)


def _stone_piece(p, mask, pcolor):
    color = STONE
    dirs = [(dx, dy) for i, (dx, dy) in enumerate(DIR8) if mask & (1 << i)]
    straight = len(dirs) == 2 and dirs[0][0] == -dirs[1][0] and dirs[0][1] == -dirs[1][1]
    post = not straight
    ph = 0.25
    t, H = 0.42, 30
    back = sorted([d for d in dirs if d[0] + d[1] < 0], key=lambda d: d[0] + d[1])
    side = [d for d in dirs if d[0] + d[1] == 0]
    front = sorted([d for d in dirs if d[0] + d[1] > 0], key=lambda d: d[0] + d[1])

    def seg(d):
        dx, dy = d
        L = math.hypot(dx, dy)
        s0 = (ph * (1.414 if dx and dy else 1.0)) if post else 0.0
        ax, ay = 0.5 + dx / L * s0, 0.5 + dy / L * s0
        _slab(p, ax, ay, 0.5 + dx * 0.5, 0.5 + dy * 0.5, t, H, color, pcolor)

    for d in back + side:
        seg(d)
    if post:
        p.box(0.5 - ph, 0.5 - ph, 0.5 + ph, 0.5 + ph, H + 8, color, mortar=True)
        for (cx, cy) in ((0.5 - ph, 0.5 - ph), (0.5 + ph - 0.13, 0.5 - ph), (0.5 - ph, 0.5 + ph - 0.13),
                         (0.5 + ph - 0.13, 0.5 + ph - 0.13)):
            p.box(cx, cy, cx + 0.13, cy + 0.13, 6, color, z0=H + 8)
    for d in front:
        seg(d)


def _band(p, color, mask):
    """The owner's pennant on a post."""
    bx, by = p.P(0.5, 0.5, 44 if mask is not None else 40)
    pygame.draw.line(p.s, (70, 50, 35), (bx, by), (bx, by - 14), 2)
    pygame.draw.polygon(p.s, color, [(bx + 1, by - 14), (bx + 10, by - 11), (bx + 1, by - 7)])


def piece_sprite(kind, color, mask, civ=None):
    """A wall-segment sprite taking connections into account (mask - DIR8 bits). With civ - from 3D renders (if any)."""
    if civ is not None:
        r3 = sprites3d.wall_piece(kind, civ, color, mask, DIR8)
        if r3 is not None:
            return r3
    key = ('w', kind, color, mask)
    spr = _cache.get(key)
    if spr is None:
        surf, ox, oy = _canvas(1, 1)
        p = _P(surf, ox, oy)
        # shadow
        sh = pygame.Surface(surf.get_size(), pygame.SRCALPHA)
        pygame.draw.polygon(sh, (0, 0, 0, 45), [(ox + 6 - HW * 0.6, oy + HH + 2), (ox + 6, oy + HH * 0.4 + 2),
                                                (ox + 6 + HW * 0.6, oy + HH + 2), (ox + 6, oy + HH * 1.6 + 2)])
        surf.blit(sh, (0, 0))
        if is_palisade(kind):
            _palisade_piece(p, mask, color)
        else:
            _stone_piece(p, mask, color)
            dirs = [d for i, d in enumerate(DIR8) if mask & (1 << i)]
            if len(dirs) != 2 or dirs[0][0] != -dirs[1][0] or dirs[0][1] != -dirs[1][1]:
                _band(p, color, mask)
        spr = _cache[key] = (surf, ox, oy)
    return spr


# ============================================================ gates
def gate_sprite(kind, color, horiz, opened, civ=None):
    if civ is not None:
        r3 = sprites3d.gate(kind, civ, color, horiz, opened)
        if r3 is not None:
            return r3
    key = ('g', kind, color, horiz, opened)
    spr = _cache.get(key)
    if spr is not None:
        return spr
    span = BUILDINGS[kind].get('span', 4)
    w, h = (span, 1) if horiz else (1, span)
    surf, ox, oy = _canvas(w, h, 90)
    p = _P(surf, ox, oy)

    def M(u, v):
        return (u, v) if horiz else (v, u)

    def ubox(u0, v0, u1, v1, hh, col, z0=0.0, top=True, mortar=False):
        x0, y0 = M(u0, v0)
        x1, y1 = M(u1, v1)
        p.box(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1), hh, col, z0=z0, top=top, mortar=mortar)

    # shadow
    sh = pygame.Surface(surf.get_size(), pygame.SRCALPHA)
    pts = [p.P(*M(0.1, 0.2)), p.P(*M(span - 0.1, 0.2)), p.P(*M(span - 0.1, 0.9)), p.P(*M(0.1, 0.9))]
    pygame.draw.polygon(sh, (0, 0, 0, 50), [(x + 8, y + 2) for x, y in pts])
    surf.blit(sh, (0, 0))
    e = span - 1.0
    if is_palisade(kind):
        logs = []
        for u0 in (0.0, e):
            for (a, b) in ((0.3, 0.3), (0.7, 0.3), (0.3, 0.7), (0.7, 0.7), (0.5, 0.5)):
                logs.append((*M(u0 + a, b), 36 if (a, b) == (0.5, 0.5) else 32, 4.6))
        if not opened:
            n = int((e - 1.0) / 0.13)
            for k in range(n + 1):
                logs.append((*M(1.0 + (e - 1.0) * k / n, 0.5), 22 + (k % 3) * 2, 3.6))
        else:
            for u0, sgn in ((1.05, 1), (e - 0.05, -1)):
                for k in range(4):
                    logs.append((*M(u0 + sgn * 0.02, 0.55 + k * 0.12), 22, 3.4))
        logs.sort(key=lambda l: (l[0] + l[1], l[0] - l[1]))
        for x, y, hh, r in logs:
            _log(p, x, y, hh, r, color)
        ubox(0.8, 0.42, e + 0.2, 0.58, 5, shade(LOG, -10), z0=30)
        for u0 in (0.5, e + 0.5):
            x, y = M(u0, 0.5)
            bx, by = p.P(x, y, 40)
            pygame.draw.line(surf, (70, 50, 35), (bx, by), (bx, by - 14), 2)
            pygame.draw.polygon(surf, color, [(bx + 1, by - 14), (bx + 10, by - 11), (bx + 1, by - 7)])
    else:
        H = 52
        ubox(0.05, 0.08, 0.95, 0.92, H, STONE, mortar=True)
        for (a, b) in ((0.05, 0.08), (0.8, 0.08), (0.05, 0.77), (0.8, 0.77), (0.42, 0.08), (0.05, 0.42),
                       (0.8, 0.42), (0.42, 0.77)):
            ubox(a, b, a + 0.15, b + 0.15, 7, STONE, z0=H)
        if not opened:
            ubox(0.95, 0.44, e + 0.05, 0.56, 34, WOOD_DOOR)
            for k in range(1, 8):
                u = 0.95 + (e - 0.9) * k / 8
                x, y = M(u, 0.56)
                pygame.draw.line(surf, shade(WOOD_DOOR, -35), p.P(x, y, 1), p.P(x, y, 33))
        ubox(0.95, 0.22, e + 0.05, 0.78, 14, STONE, z0=34, mortar=True)
        for k in range(8):
            if k % 2 == 0:
                u = 1.0 + (e - 1.0) * (k + 0.5) / 8
                ubox(u - 0.07, 0.3, u + 0.07, 0.44, 6, STONE, z0=48)
                ubox(u - 0.07, 0.56, u + 0.07, 0.7, 6, STONE, z0=48)
        if opened:
            ubox(0.95, 0.6, 1.05, 1.0, 30, WOOD_DOOR)
            ubox(e - 0.05, 0.6, e + 0.05, 1.0, 30, WOOD_DOOR)
        ubox(e + 0.05, 0.08, e + 0.95, 0.92, H, STONE, mortar=True)
        for (a, b) in ((0.05, 0.08), (0.8, 0.08), (0.05, 0.77), (0.8, 0.77), (0.42, 0.08), (0.05, 0.42),
                       (0.8, 0.42), (0.42, 0.77)):
            ubox(e + a, b, e + a + 0.15, b + 0.15, 7, STONE, z0=H)
        for u0 in (0.5, e + 0.5):
            x, y = M(u0, 0.92)
            bx, by = p.P(x, y, H - 6)
            pygame.draw.polygon(surf, color, [(bx - 5, by), (bx + 5, by), (bx + 5, by + 14), (bx, by + 18),
                                              (bx - 5, by + 14)])
            pygame.draw.polygon(surf, shade(color, -60), [(bx - 5, by), (bx + 5, by), (bx + 5, by + 14),
                                                          (bx, by + 18), (bx - 5, by + 14)], 1)
    spr = _cache[key] = (surf, ox, oy)
    return spr


def kind_sprite(kind, color, civ=None):
    """The default sprite (icons, the construction ghost): a straight segment / a closed gate along x."""
    if BUILDINGS[kind].get('gate'):
        return gate_sprite(kind, color, True, False, civ)
    return piece_sprite(kind, color, (1 << 0) | (1 << 2), civ)
