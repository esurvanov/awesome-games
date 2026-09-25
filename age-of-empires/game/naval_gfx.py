"""Процедурная графика воды: корабли, док, рыба, цвет глубины, блики и пена.

Всё рисуется кодом. Корабль строится как объёмный корпус в изометрии: точки задаются в локальных
координатах (вдоль курса u, поперёк v, высота z) и проецируются так же, как клетки мира.
"""
import bisect
import math
import random

import pygame

from .data import TILE, shade

WOOD = (150, 104, 62)
WOOD_D = (104, 70, 42)
DECK = (186, 146, 96)
SAIL = (236, 228, 204)
ROPE = (70, 52, 36)
FOAM = (214, 234, 244)
# вода DE (de_shore_naval.jpg): открытое море ≈ (50, 123, 154), ближе к берегу ≈ (81, 167, 183) — бирюза
DEEP = (48, 124, 156)
SHALLOW = (96, 196, 216)


# ============================================================ вода на карте
def shore_dist(w):
    """Расстояние (в клетках, 8-связно) от каждой клетки воды до ближайшей суши; суша — 0."""
    W, H = w.W, w.H
    INF = 99
    dist = [[0 if w.terrain[y][x] != 1 else INF for x in range(W)] for y in range(H)]
    frontier = [(x, y) for y in range(H) for x in range(W) if dist[y][x] == 0]
    d = 0
    while frontier:
        d += 1
        nxt = []
        for x, y in frontier:
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and dist[ny][nx] > d:
                        dist[ny][nx] = d
                        nxt.append((nx, ny))
        frontier = nxt
    # карта без суши вовсе — всё глубоко
    for y in range(H):
        for x in range(W):
            if dist[y][x] == INF:
                dist[y][x] = 8
    return dist


def water_color(d, v=0):
    """Цвет воды по удалённости от берега: у кромки бирюзовая, дальше тёмно-синяя."""
    t = min(1.0, max(0.0, (d - 1) / 5.0))
    t = t * t * (3 - 2 * t)
    return tuple(int(SHALLOW[i] + (DEEP[i] - SHALLOW[i]) * t) + v for i in range(3))


def decorate(big, w, dist, ox, rnd):
    """Детали поверх изометрической подложки: пена вдоль берега и мокрый песок."""
    for y in range(w.H):
        for x in range(w.W):
            if w.terrain[y][x] != 1 or dist[y][x] != 1:
                continue
            for _ in range(2):
                wx = (x + rnd.random()) * TILE
                wy = (y + rnd.random()) * TILE
                ix, iy = wx - wy + ox, (wx + wy) * 0.5
                L = rnd.randint(3, 8)
                pygame.draw.line(big, (214, 238, 232), (int(ix), int(iy)), (int(ix + L), int(iy)), 1)


class WaterFX:
    """Дешёвая анимация воды: короткие блики, мерцающие в своём ритме (рисуются только в кадре),
    и пена у берега."""

    def __init__(self, w, ox, dist):
        rnd = random.Random(11)
        pts = []
        for y in range(w.H):
            for x in range(w.W):
                if w.terrain[y][x] != 1:
                    continue
                d = dist[y][x]
                for _ in range(2 if d <= 1 else 1):
                    if rnd.random() > (0.9 if d <= 1 else 0.45):
                        continue
                    wx = (x + rnd.random()) * TILE
                    wy = (y + rnd.random()) * TILE
                    ix, iy = wx - wy + ox, (wx + wy) * 0.5
                    pts.append((iy, ix, rnd.uniform(0, math.tau), rnd.uniform(0.6, 1.4), rnd.randint(4, 10), d <= 1,
                                water_color(d)))
        pts.sort()
        self.pts = pts
        self.ys = [p[0] for p in pts]

    def draw(self, scr, cam_x, cam_y, top, view_w, view_h, t):
        i0 = bisect.bisect_left(self.ys, cam_y - 4)
        i1 = bisect.bisect_right(self.ys, cam_y + view_h + 4)
        line = pygame.draw.line
        for j in range(i0, i1):
            iy, ix, ph, sp, L, shore, base = self.pts[j]
            sx = ix - cam_x
            if sx < -12 or sx > view_w + 12:
                continue
            s = math.sin(t * sp * 1.6 + ph)
            if s < 0.35:
                continue
            sy = iy - cam_y + top
            drift = math.sin(t * 0.7 + ph) * 3
            if shore:
                c = (205 + int(45 * s), 232 + int(20 * s), 228 + int(22 * s))       # пена у берега
                line(scr, c, (sx + drift, sy), (sx + drift + L * 0.8, sy), 1)
            else:
                c = shade(base, int(20 + 45 * s))
                line(scr, c, (sx + drift, sy), (sx + drift + L * s, sy), 1)


# ============================================================ рыба
def make_fish(kind, var):
    """Силуэты рыбы под водой (тёмные спинки) — спрайт с центром в середине клетки."""
    rnd = random.Random(var * 131 + (7 if kind == 'deep_fish' else 3))
    s = pygame.Surface((48, 30), pygame.SRCALPHA)
    deep = kind == 'deep_fish'
    n = 1 if deep else 3
    for i in range(n):
        cx = 24 + (rnd.uniform(-9, 9) if not deep else 0)
        cy = 15 + (rnd.uniform(-5, 5) if not deep else 0)
        L = 20 if deep else rnd.uniform(8, 11)
        dirx = 1 if rnd.random() < 0.5 else -1
        body = (22, 44, 76, 230) if deep else (40, 72, 98, 210)
        pygame.draw.ellipse(s, body, (cx - L / 2, cy - L / 5, L, L / 2.5))
        tx = cx - dirx * L / 2
        pygame.draw.polygon(s, body, [(tx, cy), (tx - dirx * L / 3.2, cy - L / 5), (tx - dirx * L / 3.2, cy + L / 5)])
        if deep:
            pygame.draw.polygon(s, (30, 52, 80, 220), [(cx - 2, cy - L / 5), (cx + 3 * dirx, cy - L / 2.6),
                                                       (cx + 5 * dirx, cy - L / 5)])
        pygame.draw.line(s, (150, 200, 225, 170), (cx - L / 4, cy - L / 8), (cx + L / 4, cy - L / 8), 1)
    return s


def fish_ripple(scr, n, sx, sy, t):
    """Расходящиеся кольца и изредка выпрыгивающая рыбка."""
    ph = (t * 0.55 + n.var * 0.37 + n.tx * 0.13) % 1.0
    r = 4 + ph * 12
    c = (int(120 + 110 * (1 - ph)), int(170 + 70 * (1 - ph)), 230)
    pygame.draw.ellipse(scr, c, (sx - r, sy - r / 2, 2 * r, r), 1)
    jp = (t * 0.23 + n.var * 0.61 + n.ty * 0.17) % 1.0
    if jp < 0.12:
        a = jp / 0.12
        fx = sx - 8 + 16 * a
        fy = sy - math.sin(a * math.pi) * 12
        ang = math.cos(a * math.pi)
        pts = [(fx - 4, fy + ang * 2), (fx + 4, fy - ang * 2)]
        pygame.draw.line(scr, (200, 215, 225), pts[0], pts[1], 3)
        pygame.draw.circle(scr, (240, 248, 255), (int(sx - 8), int(sy)), 2, 1)
        pygame.draw.circle(scr, (240, 248, 255), (int(sx + 8), int(sy)), 2, 1)


# ============================================================ корабли
class _Proj:
    """Проекция локальных координат корабля (u — вдоль курса, v — поперёк, z — высота) на экран."""

    def __init__(self, x, y, face, k):
        sx, sy = face
        a, b = (sx + 2 * sy) / 2, (2 * sy - sx) / 2    # экранное направление → мировое
        d = math.hypot(a, b) or 1.0
        self.hx, self.hy = a / d, b / d
        self.px, self.py = -self.hy, self.hx
        self.x, self.y, self.k = x, y, k * 0.78

    def __call__(self, u, v, z=0.0):
        wx = u * self.hx + v * self.px
        wy = u * self.hy + v * self.py
        k = self.k
        return (self.x + (wx - wy) * k, self.y + (wx + wy) * 0.5 * k - z * k * 1.6)

    def facing(self, nu, nv):
        """Смотрит ли грань с внешней нормалью (nu, nv) к зрителю (на юго-восток мира)."""
        return (nu * self.hx + nv * self.px) + (nu * self.hy + nv * self.py)

    def side_front(self):
        """+1, если к зрителю обращён борт v > 0, иначе -1."""
        return 1 if self.px + self.py > 0 else -1


def _hull_outline(L, B, bow=1.25, stern=0.85):
    pts = [(L * bow, 0), (L * 0.55, B), (-L * 0.55, B), (-L * stern, B * 0.72),
           (-L * stern, -B * 0.72), (-L * 0.55, -B), (L * 0.55, -B)]
    return pts


def _hull(surf, P, L, B, H, wood, deck=DECK, stripe=None):
    top = _hull_outline(L, B)
    bot = [(u * 0.86, v * 0.72) for u, v in top]
    n = len(top)
    faces = []
    for i in range(n):
        u0, v0 = top[i]
        u1, v1 = top[(i + 1) % n]
        eu, ev = u1 - u0, v1 - v0
        nu, nv = ev, -eu            # внешняя нормаль для обхода по часовой (в локальных координатах)
        f = P.facing(nu, nv)
        if f > 0:
            faces.append((f, i))
    for f, i in faces:
        j = (i + 1) % n
        quad = [P(*bot[i], 0), P(*bot[j], 0), P(*top[j], H), P(*top[i], H)]
        c = shade(wood, int(-30 + 30 * min(1.0, f / 30.0)))
        pygame.draw.polygon(surf, c, quad)
        pygame.draw.polygon(surf, shade(c, -45), quad, 1)
        if stripe:
            a = P(*[(bot[i][q] + top[i][q]) / 2 for q in (0, 1)], H * 0.62)
            b = P(*[(bot[j][q] + top[j][q]) / 2 for q in (0, 1)], H * 0.62)
            pygame.draw.line(surf, stripe, a, b, 2)
    dk = [P(u, v, H) for u, v in top]
    pygame.draw.polygon(surf, deck, dk)
    pygame.draw.polygon(surf, shade(wood, -50), dk, 1)
    # доски палубы
    for t in (-0.45, 0.0, 0.45):
        pygame.draw.line(surf, shade(deck, -22), P(-L * 0.8, B * t, H), P(L * 0.9, B * t * 0.8, H), 1)


def _wake(surf, P, L, B, anim, moving, k):
    if moving:
        ph = (anim * 0.25) % 1.0
        for s in (-1, 1):
            a = P(-L * 0.8, s * B * 0.7)
            b = P(-L * 0.8 - 26, s * (B + 12))
            pygame.draw.line(surf, FOAM, a, b, max(1, int(2 * k)))
            for q in range(3):
                t = (ph + q / 3.0) % 1.0
                c = P(-L * 0.8 - 26 * t, s * (B * 0.7 + (12 + B * 0.3) * t))
                pygame.draw.circle(surf, (236, 246, 250), (int(c[0]), int(c[1])), max(1, int(2 * k * (1 - t)) + 1))
        # бурун у носа
        for s in (-1, 1):
            pygame.draw.line(surf, FOAM, P(L * 1.25, 0), P(L * 0.9, s * (B + 3)), 1)
    else:
        pts = [P(u, v) for u, v in _hull_outline(L * 1.18, B * 1.5)]
        pygame.draw.polygon(surf, (120, 170, 210), pts, 1)


def _shadow(surf, P, L, B):
    pts = [P(u + 3, v + 3) for u, v in _hull_outline(L, B * 0.9)]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    w, h = int(max(xs) - min(xs)) + 2, int(max(ys) - min(ys)) + 2
    s = pygame.Surface((w, h), pygame.SRCALPHA)
    pygame.draw.polygon(s, (10, 30, 60, 70), [(p[0] - min(xs), p[1] - min(ys)) for p in pts])
    surf.blit(s, (min(xs), min(ys)))


def _mast(surf, P, u, H, M, k):
    pygame.draw.line(surf, ROPE, P(u, 0, H), P(u, 0, H + M), max(2, int(2.4 * k)))


def _square_sail(surf, P, u, H, M, S, color, k, cross=True, billow=4):
    z0, z1 = H + M * 0.3, H + M * 0.92
    pts = [P(u, -S, z1), P(u + billow * 0.4, 0, z1 + 1), P(u, S, z1), P(u + billow, S * 0.95, z0),
           P(u + billow * 1.6, 0, z0 - 2), P(u + billow, -S * 0.95, z0)]
    pygame.draw.polygon(surf, color, pts)
    pygame.draw.polygon(surf, shade(color, -70), pts, 1)
    if cross:
        pygame.draw.line(surf, shade(color, 45), P(u + billow * 0.5, 0, z1 - 2), P(u + billow * 1.3, 0, z0 + 1), 2)
    pygame.draw.line(surf, ROPE, P(u, -S - 2, z1), P(u, S + 2, z1), max(1, int(2 * k)))


def _lateen(surf, P, u, H, M, S, color):
    pts = [P(u, 0, H + M), P(u - S * 1.2, 0, H + 4), P(u + S * 0.4, 0, H + 3)]
    pygame.draw.polygon(surf, color, pts)
    pygame.draw.polygon(surf, shade(color, -70), pts, 1)


def _oars(surf, P, L, B, H, anim, moving, side, n, k):
    sw = math.sin(anim * 0.8) * (5 if moving else 1)
    for i in range(n):
        u = -L * 0.5 + L * 1.0 * i / max(1, n - 1)
        a = P(u, side * B * 0.9, H * 0.7)
        b = P(u - 3 + sw, side * (B + 9), 0)
        pygame.draw.line(surf, (120, 86, 50), a, b, max(1, int(1.4 * k)))


def _flag(surf, P, u, z, color, k):
    bx, by = P(u, 0, z)
    pygame.draw.polygon(surf, color, [(bx, by), (bx + 9 * k, by + 2 * k), (bx, by + 5 * k)])


def _fire(surf, P, u, z, k, big=False):
    t = pygame.time.get_ticks() / 1000.0
    bx, by = P(u, 0, z)
    for i in range(3 if not big else 5):
        fl = math.sin(t * 13 + i * 2.1) * 2
        r = (4 - i * 0.6) * k * (1.3 if big else 1.0)
        c = ((255, 90, 30), (255, 160, 40), (255, 230, 120), (255, 120, 30), (255, 200, 80))[i]
        pygame.draw.circle(surf, c, (int(bx + fl * 0.6), int(by - i * 3 * k - 2)), max(1, int(r)))


def draw_ship(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None,
              moving=False):
    P = _Proj(x, y, face, k)
    side = P.side_front()
    kk = k
    if kind == 'fishing_ship':
        L, B, H = 13, 5.5, 5
        _shadow(surf, P, L, B)
        _wake(surf, P, L, B, anim, moving, kk)
        # сеть за бортом
        ns = -side
        for i in range(5):
            a = P(-L * 0.3 + i * 3, ns * (B + 1), 0)
            b = P(-L * 0.3 + i * 3 + 2, ns * (B + 8), 0)
            pygame.draw.line(surf, (190, 185, 165), a, b, 1)
        pygame.draw.line(surf, (200, 60, 50), P(-L * 0.3, ns * (B + 8)), P(L * 0.3, ns * (B + 8)), 2)
        _hull(surf, P, L, B, H, (160, 118, 72))
        if carry_res:
            for i in range(4):
                c = P(-4 + i * 2.5, (i % 2) * 2 - 1, H + 1)
                pygame.draw.ellipse(surf, (170, 190, 205), (c[0] - 3, c[1] - 1.5, 6, 3))
        _mast(surf, P, 2, H, 22, kk)
        _lateen(surf, P, 2, H, 22, 11, color)
        pygame.draw.line(surf, ROPE, P(2, 0, H + 20), P(-L * 0.4, ns * (B + 6), 0), 1)
        return
    if kind == 'transport_ship':
        L, B, H = 17, 9, 6
        _shadow(surf, P, L, B)
        _wake(surf, P, L, B, anim, moving, kk)
        _hull(surf, P, L, B, H, (138, 98, 60), stripe=color)
        for (u, v) in ((-8, -4), (-8, 3), (-3, -4), (8, 2)):
            c = P(u, v, H)
            pygame.draw.rect(surf, (150, 112, 70), (c[0] - 4, c[1] - 7, 8, 7))
            pygame.draw.rect(surf, (90, 64, 40), (c[0] - 4, c[1] - 7, 8, 7), 1)
        _mast(surf, P, 3, H, 30, kk)
        _square_sail(surf, P, 3, H, 30, 12, color, kk)
        _flag(surf, P, 3, H + 31, color, kk)
        return
    if kind in ('galley', 'war_galley', 'fire_galley', 'fire_ship', 'fast_fire_ship'):
        big = kind in ('war_galley', 'fire_ship', 'fast_fire_ship')
        L, B, H = (22, 6.5, 6) if big else (19, 6, 5)
        fire = 'fire' in kind
        wood = (120, 78, 48) if fire else (142, 96, 56)
        _shadow(surf, P, L, B)
        _wake(surf, P, L, B, anim, moving, kk)
        _oars(surf, P, L, B, H, anim, moving, -side, 6 if big else 5, kk)
        _hull(surf, P, L, B, H, wood, stripe=color)
        _oars(surf, P, L, B, H, anim, moving, side, 6 if big else 5, kk)
        # щиты вдоль борта
        for i in range(5):
            c = P(-L * 0.5 + i * L * 0.25, side * B * 0.95, H + 2)
            pygame.draw.circle(surf, shade(color, -10 if i % 2 else 25), (int(c[0]), int(c[1])), max(2, int(2.4 * kk)))
        # таран на носу
        pygame.draw.line(surf, (150, 150, 160), P(L * 1.2, 0, 1), P(L * 1.5, 0, 1), max(2, int(3 * kk)))
        M = 30 if big else 26
        _mast(surf, P, 1, H, M, kk)
        _square_sail(surf, P, 1, H, M, 11 if big else 10, color if not fire else shade(color, -25), kk)
        if kind == 'war_galley':
            _mast(surf, P, -L * 0.55, H, 18, kk)
            _lateen(surf, P, -L * 0.55, H, 18, 8, SAIL)
        _flag(surf, P, 1, H + M + 1, color, kk)
        if fire:
            # жаровня и сифон на носу
            bx, by = P(L * 0.95, 0, H)
            pygame.draw.rect(surf, (70, 60, 55), (bx - 4, by - 6, 8, 6))
            _fire(surf, P, L * 0.95, H + 6, kk, big=swing > 0 or kind == 'fast_fire_ship')
            if swing > 0:
                a = P(L * 1.2, 0, H + 2)
                b = P(L * 2.4, 0, H - 2)
                pygame.draw.line(surf, (255, 150, 40), a, b, 4)
                pygame.draw.line(surf, (255, 230, 130), a, b, 2)
        return
    if kind == 'galleon':
        L, B, H = 24, 8, 9
        _shadow(surf, P, L, B)
        _wake(surf, P, L, B, anim, moving, kk)
        _hull(surf, P, L, B, H, (122, 80, 46), deck=(176, 136, 88), stripe=(210, 180, 90))
        # кормовая надстройка
        top = [(-L * 0.85, -B * 0.7), (-L * 0.4, -B * 0.9), (-L * 0.4, B * 0.9), (-L * 0.85, B * 0.7)]
        pygame.draw.polygon(surf, (132, 88, 52), [P(u, v, H + 7) for u, v in top])
        pygame.draw.polygon(surf, (80, 52, 30), [P(u, v, H + 7) for u, v in top], 1)
        for u in (-L * 0.4, -L * 0.85):
            for v in (-B * 0.8, B * 0.8):
                pygame.draw.line(surf, (80, 52, 30), P(u, v, H), P(u, v, H + 7), 1)
        for u, M, S in ((L * 0.45, 30, 11), (-2, 40, 14), (-L * 0.55, 26, 9)):
            _mast(surf, P, u, H, M, kk)
            _square_sail(surf, P, u, H, M, S, SAIL if u != -2 else color, kk)
        _flag(surf, P, -2, H + 41, color, kk)
        return
    if kind in ('demolition_ship', 'heavy_demolition_ship'):
        heavy = kind == 'heavy_demolition_ship'
        L, B, H = (16, 7, 4) if heavy else (14, 6, 4)
        _shadow(surf, P, L, B)
        _wake(surf, P, L, B, anim, moving, kk)
        _hull(surf, P, L, B, H, (110, 84, 60), deck=(150, 120, 86), stripe=color)
        for (u, v) in ((-6, -2.5), (-6, 2.5), (-1, 0), (4, -2.5), (4, 2.5)) + (((9, 0),) if heavy else ()):
            c = P(u, v, H)
            r = int(4 * kk)
            pygame.draw.ellipse(surf, (96, 60, 34), (c[0] - r, c[1] - 2 * r, 2 * r, 2 * r))
            pygame.draw.line(surf, (60, 40, 25), (c[0] - r, c[1] - r * 1.4), (c[0] + r, c[1] - r * 1.4), 1)
            pygame.draw.line(surf, (60, 40, 25), (c[0] - r, c[1] - r * 0.5), (c[0] + r, c[1] - r * 0.5), 1)
        # фитиль с искрой
        c = P(-1, 0, H)
        t = pygame.time.get_ticks() / 90
        pygame.draw.line(surf, (40, 30, 20), (c[0], c[1] - 8 * kk), (c[0] + 3, c[1] - 13 * kk), 1)
        pygame.draw.circle(surf, (255, 220 if int(t) % 2 else 140, 60), (int(c[0] + 3), int(c[1] - 13 * kk)), 2)
        _mast(surf, P, -L * 0.6, H, 16, kk)
        _lateen(surf, P, -L * 0.6, H, 16, 7, color)
        return
    if kind == 'cannon_galleon':
        L, B, H = 25, 8.5, 9
        _shadow(surf, P, L, B)
        _wake(surf, P, L, B, anim, moving, kk)
        _hull(surf, P, L, B, H, (96, 70, 48), deck=(160, 124, 84), stripe=(40, 36, 34))
        # пушечные порты по борту
        for i in range(5):
            u = -L * 0.55 + i * L * 0.27
            c = P(u, side * B * 0.9, H * 0.55)
            pygame.draw.rect(surf, (25, 22, 20), (c[0] - 2, c[1] - 2, 4, 4))
        # пушка на носу
        pygame.draw.line(surf, (50, 50, 55), P(L * 0.8, 0, H + 3), P(L * 1.25, 0, H + 4), max(3, int(4 * kk)))
        for u, M, S in ((L * 0.35, 34, 12), (-L * 0.4, 30, 11)):
            _mast(surf, P, u, H, M, kk)
            _square_sail(surf, P, u, H, M, S, color if u > 0 else SAIL, kk)
        _flag(surf, P, L * 0.35, H + 35, color, kk)
        if swing > 0:
            c = P(L * 1.3, 0, H + 4)
            for i in range(3):
                pygame.draw.circle(surf, (200, 196, 190), (int(c[0] + i * 5), int(c[1] - i * 2)), int(4 + i * 2), 0)
        return
    # неизвестный корабль — простая лодка
    L, B, H = 14, 6, 5
    _wake(surf, P, L, B, anim, moving, kk)
    _hull(surf, P, L, B, H, WOOD)
    _mast(surf, P, 0, H, 20, kk)
    _square_sail(surf, P, 0, H, 20, 8, color, kk)


# ============================================================ док
def draw_dock(p, surf, color, s):
    """Деревянный причал на сваях с сараем и краном. p — gfx.IsoPainter, s — сторона в клетках (3)."""
    # сваи в воде (видны по передним краям)
    for i in range(7):
        t = 0.2 + (s - 0.4) * i / 6
        for (x, y) in ((t, s - 0.12), (s - 0.12, t)):
            p.box(x - 0.05, y - 0.05, x + 0.05, y + 0.05, 10, (84, 58, 36), z0=-6, top=False)
    # настил
    p.box(0.1, 0.1, s - 0.1, s - 0.1, 5, (150, 110, 70), z0=4, tex='wood')
    for i in range(1, 12):
        t = 0.1 + (s - 0.2) * i / 12
        p.line((t, 0.1, 9), (t, s - 0.1, 9), (126, 90, 56))
    # сарай у дальнего угла
    p.box(0.3, 0.3, 1.5, 1.3, 20, (178, 140, 96), z0=9, top=False, tex='wood')
    p.gable(0.3, 0.3, 1.5, 1.3, 29, 14, (120, 82, 50), (178, 140, 96), axis='x')
    p.door(0.9, 1.3, 0.3, 11 + 9)
    # бочки и сети
    for (x, y) in ((1.9, 0.5), (2.2, 0.55), (2.05, 0.85)):
        cx, cy = p.P(x, y, 9)
        pygame.draw.ellipse(surf, (110, 72, 40), (cx - 5, cy - 11, 10, 12))
        pygame.draw.line(surf, (70, 46, 28), (cx - 5, cy - 7), (cx + 5, cy - 7), 1)
    for i in range(4):
        a = p.P(0.6 + i * 0.25, 2.2, 9)
        pygame.draw.line(surf, (200, 196, 176), a, (a[0] + 4, a[1] + 8), 1)
    # кран: мачта и стрела с грузом над водой
    base = p.P(2.3, 2.3, 9)
    top = (base[0], base[1] - 44)
    pygame.draw.line(surf, (92, 64, 40), base, top, 4)
    tip = p.P(3.3, 2.9, 9 + 42)
    pygame.draw.line(surf, (92, 64, 40), (top[0], top[1] + 6), tip, 3)
    pygame.draw.line(surf, ROPE, top, tip, 1)
    pygame.draw.line(surf, ROPE, tip, (tip[0], tip[1] + 20), 1)
    pygame.draw.rect(surf, (140, 100, 60), (tip[0] - 5, tip[1] + 20, 10, 8))
    pygame.draw.rect(surf, (80, 56, 34), (tip[0] - 5, tip[1] + 20, 10, 8), 1)
    p.flag(1.5, 0.3, 42, color)
    p.banner_l(0.55, 1.3, 26, color)
