"""Процедурная графика в изометрии: здания, деревья, ресурсы, юниты.

Все изображения рисуются кодом — никаких чужих картинок.
"""
import math
import random

import pygame

from .data import BUILDINGS, UNITS, RES_COLOR, HW, HH, shade

_shadow_cache = {}


def shadow(surf, x, y, w, h, a=70):
    key = (int(w), int(h), a)
    s = _shadow_cache.get(key)
    if s is None:
        s = pygame.Surface((max(1, int(w)), max(1, int(h))), pygame.SRCALPHA)
        pygame.draw.ellipse(s, (0, 0, 0, a), s.get_rect())
        _shadow_cache[key] = s
    surf.blit(s, (int(x), int(y)))


# ============================================================ юниты
def draw_unit(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None,
              moving=False):
    """face — направление в экранных координатах."""
    fx, fy = face
    hx = 1 if fx >= 0 else -1
    dark = shade(color, -80)
    skin = (232, 190, 145)
    bob = math.sin(anim) * 1.0 * k if moving else 0

    def P(a, b, bb=True):
        return int(x + a * k), int(y + b * k + (bob if bb else 0))

    lw = max(1, int(2 * k))
    if kind in ('scout', 'knight'):
        shadow(surf, x - 14 * k, y - 3 * k, 28 * k, 9 * k)
        horse = (130, 88, 50) if kind == 'scout' else (75, 62, 55)
        for i, lx in enumerate((-7, -4, 5, 8)):
            off = math.sin(anim + i * 1.7) * 2.5 if moving else 0
            pygame.draw.line(surf, shade(horse, -40), P(lx, -3), P(lx + off, 3, False), lw)
        pygame.draw.ellipse(surf, horse, (*P(-11, -11), int(22 * k), int(10 * k)))
        if kind == 'knight':
            pygame.draw.ellipse(surf, color, (*P(-9, -10), int(18 * k), int(8 * k)))
        pygame.draw.line(surf, shade(horse, -30), P(-10 * hx, -8), P(-15 * hx, -2), lw)
        pygame.draw.polygon(surf, horse, [P(6 * hx, -10), P(11 * hx, -16), P(14 * hx, -13), P(9 * hx, -6)])
        pygame.draw.circle(surf, horse, P(13 * hx, -14), int(3.3 * k))
        pygame.draw.ellipse(surf, dark, (*P(-11, -11), int(22 * k), int(10 * k)), 1)
        pygame.draw.circle(surf, color, P(0, -15), int(4.6 * k))
        pygame.draw.circle(surf, dark, P(0, -15), int(4.6 * k), 1)
        head = (175, 175, 185) if kind == 'knight' else skin
        pygame.draw.circle(surf, head, P(0, -21), int(3.2 * k))
        s = swing * 20
        if kind == 'knight':
            pygame.draw.line(surf, (200, 180, 140), P(2 * hx, -15), P((19 + s * 0.3) * hx, -22 + s * 0.4), lw)
        else:
            pygame.draw.line(surf, (210, 210, 220), P(3 * hx, -15), P(10 * hx, -21 + s * 0.4), lw)
        return
    if kind == 'ram':
        shadow(surf, x - 16 * k, y - 4 * k, 32 * k, 11 * k)
        wood = (125, 88, 52)
        s = swing * 12
        pygame.draw.line(surf, (95, 68, 40), P((6 + s) * hx, -7), P((18 + s) * hx, -7), max(2, int(4 * k)))
        pygame.draw.circle(surf, (150, 150, 160), P((18 + s) * hx, -7), int(3 * k))
        pygame.draw.rect(surf, wood, (*P(-13, -13), int(26 * k), int(12 * k)))
        pygame.draw.polygon(surf, shade(wood, 20), [P(-15, -11), P(0, -21), P(15, -11)])
        pygame.draw.polygon(surf, shade(wood, -40), [P(-15, -11), P(0, -21), P(15, -11)], 1)
        pygame.draw.line(surf, color, P(-13, -5), P(13, -5), max(1, int(3 * k)))
        pygame.draw.rect(surf, shade(wood, -50), (*P(-13, -13), int(26 * k), int(12 * k)), 1)
        for wx in (-9, 9):
            pygame.draw.circle(surf, (60, 45, 30), P(wx, 0, False), int(3.5 * k))
            pygame.draw.circle(surf, (110, 90, 60), P(wx, 0, False), int(1.5 * k))
        return
    art = UNITS[kind].get('art') if kind in UNITS else ART.get(kind)
    if callable(art):
        art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
        return
    key = (kind, id(art))
    spec = _SPEC.get(key)
    if spec is None:
        spec = dict(FOOT_ART.get(kind, {'helmet': 'hood', 'weapon': 'sword'}))
        if art:
            spec.update(art)
        _SPEC[key] = spec
    draw_foot(surf, color, x, y, face, anim, swing, k, carry_res, moving, **spec)


_SPEC = {}      # (вид, id(art)) → собранный вид пешего юнита (FOOT_ART + UNITS[kind]['art'])


# дополнительные «позы» без собственной записи в UNITS (например, разложенный требушет — Unit.look()):
# вид → функция отрисовки с той же сигнатурой, что UNITS[kind]['art']; заполняет контент
ART = {}

# внешний вид пеших юнитов: шлем и оружие (контент задаёт то же через UNITS[kind]['art'])
FOOT_ART = {
    'villager': {'helmet': 'hat', 'weapon': 'tool'},
    'militia': {'helmet': 'iron', 'weapon': 'sword'},
    'spearman': {'helmet': 'iron', 'weapon': 'spear'},
    'archer': {'helmet': 'hood', 'weapon': 'bow'},
    'skirmisher': {'helmet': 'hood', 'weapon': 'javelin'},
}


def draw_foot(surf, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False,
              helmet='hood', weapon=None, shield=False):
    """Пеший человечек. helmet: 'hat' | 'iron' | 'crest' | 'hood'; weapon: 'tool' | 'sword' | 'longsword' |
    'spear' | 'bow' | 'javelin' | None; shield — круглый щит в цвет игрока."""
    fx, fy = face
    hx = 1 if fx >= 0 else -1
    dark = shade(color, -80)
    skin = (232, 190, 145)
    bob = math.sin(anim) * 1.0 * k if moving else 0

    def P(a, b, bb=True):
        return int(x + a * k), int(y + b * k + (bob if bb else 0))

    lw = max(1, int(2 * k))
    shadow(surf, x - 7 * k, y - 2 * k, 14 * k, 5 * k)
    ls = math.sin(anim) * 2.2 if moving else 0
    pygame.draw.line(surf, shade(dark, -10), P(-2, -4), P(-2 + ls, 1, False), lw)
    pygame.draw.line(surf, shade(dark, -10), P(2, -4), P(2 - ls, 1, False), lw)
    if carry_res:
        pygame.draw.rect(surf, RES_COLOR[carry_res], (*P(-8 * hx - 3, -12), int(6 * k), int(6 * k)))
        pygame.draw.rect(surf, (40, 30, 20), (*P(-8 * hx - 3, -12), int(6 * k), int(6 * k)), 1)
    pygame.draw.circle(surf, color, P(0, -8), int(5.5 * k))
    pygame.draw.circle(surf, dark, P(0, -8), int(5.5 * k), 1)
    pygame.draw.circle(surf, skin, P(0, -15), int(3.4 * k))
    if helmet == 'hat':
        pygame.draw.ellipse(surf, (205, 175, 105), (*P(-5, -19), int(10 * k), int(4 * k)))
    elif helmet == 'iron':
        pygame.draw.ellipse(surf, (160, 160, 172), (*P(-3.8, -19.5), int(7.6 * k), int(5.5 * k)))
    elif helmet == 'crest':
        # глухой шлем с наносником и гребнем в цвет игрока
        pygame.draw.ellipse(surf, (130, 132, 145), (*P(-4.2, -20), int(8.4 * k), int(6.5 * k)))
        pygame.draw.line(surf, (95, 96, 108), P(1.5 * hx, -17), P(1.5 * hx, -13.5), max(1, int(1.3 * k)))
        pygame.draw.line(surf, shade(color, 30), P(-3 * hx, -21), P(2 * hx, -21.5), max(1, int(2 * k)))
    else:
        pygame.draw.ellipse(surf, shade(color, -40), (*P(-3.8, -19.5), int(7.6 * k), int(5 * k)))
    if shield:
        sx, sy = P(-5 * hx, -9)
        pygame.draw.circle(surf, shade(color, -20), (sx, sy), max(2, int(3.6 * k)))
        pygame.draw.circle(surf, (185, 170, 120), (sx, sy), max(2, int(3.6 * k)), 1)
        pygame.draw.circle(surf, (200, 200, 210), (sx, sy), max(1, int(1 * k)))
    hand = P(5 * hx, -8)
    s = swing / 0.3 if swing > 0 else 0
    if weapon == 'tool':
        tip = P((9 - s * 2) * hx, -16 + s * 9)
        pygame.draw.line(surf, (120, 88, 55), hand, tip, lw)
        pygame.draw.circle(surf, (150, 150, 160), tip, max(1, int(1.8 * k)))
    elif weapon == 'sword':
        pygame.draw.line(surf, (215, 215, 225), hand, P((12 + s * 2) * hx, -15 + s * 9), lw)
        pygame.draw.line(surf, (120, 90, 50), P(4 * hx, -10), P(6 * hx, -6), lw)
    elif weapon == 'longsword':
        pygame.draw.line(surf, (225, 225, 235), hand, P((14 + s * 3) * hx, -18 + s * 11), lw)
        pygame.draw.line(surf, (190, 160, 70), P(3 * hx, -10), P(7 * hx, -6), lw)
    elif weapon == 'spear':
        pygame.draw.line(surf, (140, 105, 65), P(3 * hx, 0), P((10 + s * 5) * hx, -25 + s * 6), lw)
        pygame.draw.circle(surf, (200, 200, 210), P((10 + s * 5) * hx, -25 + s * 6), max(1, int(1.8 * k)))
    elif weapon == 'bow':
        bx, by = P(6 * hx, -10)
        r = pygame.Rect(0, 0, int(8 * k), int(16 * k))
        r.center = (bx, by)
        if hx > 0:
            pygame.draw.arc(surf, (130, 85, 40), r, -math.pi / 2, math.pi / 2, lw)
        else:
            pygame.draw.arc(surf, (130, 85, 40), r, math.pi / 2, 3 * math.pi / 2, lw)
        pygame.draw.line(surf, (220, 220, 220), (bx, r.top), (bx, r.bottom), 1)
    elif weapon == 'javelin':
        pygame.draw.line(surf, (150, 115, 70), P(2 * hx, -5), P((12 + s * 3) * hx, -17), lw)
        pygame.draw.polygon(surf, (100, 150, 180), [P(3 * hx, -8), P(-3 * hx, -5), P(-2 * hx, 0), P(4 * hx, -2)])


# ============================================================ природа
TREE_ANCHOR = (30, 78)     # точка «корня» дерева в спрайте


def make_tree(seed):
    rnd = random.Random(seed * 7919 + 13)
    s = pygame.Surface((60, 84), pygame.SRCALPHA)
    ax, ay = TREE_ANCHOR
    pygame.draw.ellipse(s, (0, 0, 0, 70), (ax - 20, ay - 8, 44, 14))
    pygame.draw.rect(s, (92, 62, 36), (ax - 3, ay - 26, 6, 26))
    if seed % 3 == 2:   # ель
        base = (36 + rnd.randint(-6, 6), 88 + rnd.randint(-10, 10), 48)
        for i, (w, y) in enumerate(((42, ay - 14), (34, ay - 30), (26, ay - 44), (16, ay - 56))):
            c = shade(base, i * 8)
            pts = [(ax - w // 2, y), (ax, y - 22), (ax + w // 2, y)]
            pygame.draw.polygon(s, shade(base, -25), [(p[0] + 2, p[1] + 2) for p in pts])
            pygame.draw.polygon(s, c, pts)
            pygame.draw.line(s, shade(c, 25), (ax - w // 4, y - 6), (ax, y - 20), 1)
    else:
        base = (58 + rnd.randint(-10, 10), 116 + rnd.randint(-15, 15), 48 + rnd.randint(-8, 8))
        blobs = [(ax, ay - 42, 17), (ax - 11, ay - 34, 12), (ax + 11, ay - 33, 12), (ax, ay - 56, 12),
                 (ax - 8, ay - 50, 10), (ax + 9, ay - 49, 10)]
        for (bx, by, r) in blobs:
            pygame.draw.circle(s, shade(base, -38), (bx + 2, by + 3), r)
        for (bx, by, r) in blobs:
            pygame.draw.circle(s, base, (bx, by), r)
        for (bx, by, r) in blobs:
            pygame.draw.circle(s, shade(base, 22), (bx - r // 3, by - r // 3), r // 2)
        for _ in range(10):
            pygame.draw.circle(s, shade(base, 40), (ax + rnd.randint(-14, 14), ay - rnd.randint(34, 62)), 2)
    return s


def make_rocks(color, seed, sparkle=False):
    rnd = random.Random(seed * 31 + 7)
    s = pygame.Surface((64, 40), pygame.SRCALPHA)
    pygame.draw.ellipse(s, (0, 0, 0, 60), (8, 20, 48, 18))
    for _ in range(6):
        w = rnd.randint(14, 22)
        h = rnd.randint(10, 15)
        x = rnd.randint(8, 56 - w)
        y = rnd.randint(8, 34 - h)
        c = shade(color, rnd.randint(-25, 15))
        pygame.draw.ellipse(s, c, (x, y, w, h))
        pygame.draw.ellipse(s, shade(c, -60), (x, y, w, h), 1)
        pygame.draw.ellipse(s, shade(c, 45), (x + 3, y + 2, w // 2, h // 3))
    if sparkle:
        for _ in range(5):
            pygame.draw.circle(s, (255, 250, 200), (rnd.randint(12, 52), rnd.randint(10, 30)), 1)
    return s


def make_bush(seed):
    rnd = random.Random(seed * 17 + 3)
    s = pygame.Surface((64, 44), pygame.SRCALPHA)
    pygame.draw.ellipse(s, (0, 0, 0, 60), (12, 26, 40, 14))
    for (bx, by, r) in ((32, 22, 13), (22, 26, 10), (42, 26, 10), (32, 30, 9)):
        pygame.draw.circle(s, (46, 104, 42), (bx, by), r)
        pygame.draw.circle(s, (68, 132, 58), (bx - 3, by - 3), r // 2)
    for _ in range(14):
        pygame.draw.circle(s, (205, 40, 72), (rnd.randint(20, 44), rnd.randint(14, 34)), 2)
    return s


# ============================================================ здания
class IsoPainter:
    """Рисует объёмные коробки/крыши в изометрии; координаты — клетки и пиксели высоты."""

    def __init__(self, surf, ox, oy):
        self.s = surf
        self.ox, self.oy = ox, oy

    def P(self, x, y, z=0.0):
        return (self.ox + (x - y) * HW, self.oy + (x + y) * HH - z)

    def poly(self, pts, color, outline=True):
        sp = [self.P(*p) for p in pts]
        pygame.draw.polygon(self.s, color, sp)
        if outline:
            pygame.draw.polygon(self.s, shade(color, -70), sp, 1)

    def line(self, a, b, color, w=1):
        pygame.draw.line(self.s, color, self.P(*a), self.P(*b), w)

    def box(self, x0, y0, x1, y1, h, color, z0=0.0, top=True, tex=None):
        lc = color
        rc = shade(color, -38)
        # левая (юго-западная) грань: y = y1
        self.poly([(x0, y1, z0), (x1, y1, z0), (x1, y1, z0 + h), (x0, y1, z0 + h)], lc)
        # правая (юго-восточная) грань: x = x1
        self.poly([(x1, y1, z0), (x1, y0, z0), (x1, y0, z0 + h), (x1, y1, z0 + h)], rc)
        if tex == 'stone':
            for z in range(int(z0) + 6, int(z0 + h) - 1, 6):
                self.line((x0, y1, z), (x1, y1, z), shade(lc, -22))
                self.line((x1, y1, z), (x1, y0, z), shade(rc, -22))
        elif tex == 'wood':
            n = max(2, int((x1 - x0) * 6))
            for i in range(1, n):
                t = x0 + (x1 - x0) * i / n
                self.line((t, y1, z0), (t, y1, z0 + h), shade(lc, -25))
            n = max(2, int((y1 - y0) * 6))
            for i in range(1, n):
                t = y0 + (y1 - y0) * i / n
                self.line((x1, t, z0), (x1, t, z0 + h), shade(rc, -25))
        elif tex == 'timber':
            self.line((x0, y1, z0 + h * 0.5), (x1, y1, z0 + h * 0.5), shade(lc, -90), 2)
            self.line((x1, y1, z0 + h * 0.5), (x1, y0, z0 + h * 0.5), shade(rc, -90), 2)
            self.line((x0, y1, z0), (x0 + (x1 - x0) * 0.3, y1, z0 + h), shade(lc, -90), 2)
            self.line((x1, y1 - (y1 - y0) * 0.3, z0 + h), (x1, y0, z0), shade(rc, -90), 2)
        if top:
            self.poly([(x0, y0, z0 + h), (x1, y0, z0 + h), (x1, y1, z0 + h), (x0, y1, z0 + h)], shade(color, 22))

    def gable(self, x0, y0, x1, y1, z, rh, color, wall, axis='x', ov=0.1):
        if axis == 'x':
            ym = (y0 + y1) / 2
            self.poly([(x0 - ov, y0 - ov, z), (x1 + ov, y0 - ov, z), (x1 + ov, ym, z + rh), (x0 - ov, ym, z + rh)],
                      shade(color, -30))
            self.poly([(x1, y0, z), (x1, y1, z), (x1, ym, z + rh)], shade(wall, -38))
            self.poly([(x0 - ov, y1 + ov, z), (x1 + ov, y1 + ov, z), (x1 + ov, ym, z + rh), (x0 - ov, ym, z + rh)],
                      color)
            n = int((x1 - x0) * 5)
            for i in range(1, n + 1):
                t = x0 - ov + (x1 - x0 + 2 * ov) * i / (n + 1)
                self.line((t, y1 + ov, z), (t, ym, z + rh), shade(color, -28))
            self.line((x0 - ov, ym, z + rh), (x1 + ov, ym, z + rh), shade(color, 40), 2)
        else:
            xm = (x0 + x1) / 2
            self.poly([(x0 - ov, y0 - ov, z), (x0 - ov, y1 + ov, z), (xm, y1 + ov, z + rh), (xm, y0 - ov, z + rh)],
                      shade(color, -30))
            self.poly([(x0, y1, z), (x1, y1, z), (xm, y1, z + rh)], wall)
            self.poly([(x1 + ov, y0 - ov, z), (x1 + ov, y1 + ov, z), (xm, y1 + ov, z + rh), (xm, y0 - ov, z + rh)],
                      shade(color, -18))
            n = int((y1 - y0) * 5)
            for i in range(1, n + 1):
                t = y0 - ov + (y1 - y0 + 2 * ov) * i / (n + 1)
                self.line((x1 + ov, t, z), (xm, t, z + rh), shade(color, -45))
            self.line((xm, y0 - ov, z + rh), (xm, y1 + ov, z + rh), shade(color, 40), 2)

    def hip(self, x0, y0, x1, y1, z, rh, color, ov=0.1):
        x0, y0, x1, y1 = x0 - ov, y0 - ov, x1 + ov, y1 + ov
        a = ((x0 + x1) / 2, (y0 + y1) / 2, z + rh)
        self.poly([(x0, y0, z), (x1, y0, z), a], shade(color, -40))
        self.poly([(x0, y0, z), (x0, y1, z), a], shade(color, -30))
        self.poly([(x0, y1, z), (x1, y1, z), a], color)
        self.poly([(x1, y0, z), (x1, y1, z), a], shade(color, -22))

    def crenels(self, x0, y0, x1, y1, z, color, step=0.32, sz=0.14, h=5):
        pts = []
        n = max(1, int((x1 - x0) / step))
        for i in range(n + 1):
            t = x0 + (x1 - x0) * i / n
            pts.append((t, y0))
            pts.append((t, y1))
        n = max(1, int((y1 - y0) / step))
        for i in range(n + 1):
            t = y0 + (y1 - y0) * i / n
            pts.append((x0, t))
            pts.append((x1, t))
        pts = sorted(set((round(a, 3), round(b, 3)) for a, b in pts), key=lambda p: p[0] + p[1])
        for (cx, cy) in pts:
            self.box(cx - sz / 2, cy - sz / 2, cx + sz / 2, cy + sz / 2, h, color, z0=z)

    def door(self, xm, y1, w, h, color=(58, 40, 26)):
        self.poly([(xm - w / 2, y1, 0), (xm + w / 2, y1, 0), (xm + w / 2, y1, h), (xm, y1, h + 4),
                   (xm - w / 2, y1, h)], color)

    def window_l(self, xm, y1, z, w=0.12, h=7):
        self.poly([(xm - w / 2, y1, z), (xm + w / 2, y1, z), (xm + w / 2, y1, z + h), (xm - w / 2, y1, z + h)],
                  (45, 38, 34), outline=False)

    def window_r(self, x1, ym, z, w=0.12, h=7):
        self.poly([(x1, ym - w / 2, z), (x1, ym + w / 2, z), (x1, ym + w / 2, z + h), (x1, ym - w / 2, z + h)],
                  (38, 32, 30), outline=False)

    def flag(self, x, y, z, color, h=18):
        bx, by = self.P(x, y, z)
        pygame.draw.line(self.s, (70, 50, 35), (bx, by), (bx, by - h), 2)
        pygame.draw.polygon(self.s, color, [(bx + 1, by - h), (bx + 13, by - h + 4), (bx + 1, by - h + 9)])
        pygame.draw.polygon(self.s, shade(color, -60), [(bx + 1, by - h), (bx + 13, by - h + 4), (bx + 1, by - h + 9)], 1)

    def banner_l(self, xm, y1, z, color, w=0.18, h=12):
        self.poly([(xm - w / 2, y1 + 0.01, z), (xm + w / 2, y1 + 0.01, z), (xm + w / 2, y1 + 0.01, z - h),
                   (xm, y1 + 0.01, z - h - 4), (xm - w / 2, y1 + 0.01, z - h)], color)

    def emblem(self, x, y, z, color, kind):
        cx, cy = self.P(x, y, z)
        cx, cy = int(cx), int(cy)
        r = 7
        pygame.draw.circle(self.s, color, (cx, cy), r)
        pygame.draw.circle(self.s, shade(color, -70), (cx, cy), r, 1)
        wc = (245, 240, 230)
        if kind == 'swords':
            pygame.draw.line(self.s, wc, (cx - 4, cy + 4), (cx + 4, cy - 4), 2)
            pygame.draw.line(self.s, wc, (cx - 4, cy - 4), (cx + 4, cy + 4), 2)
        elif kind == 'target':
            pygame.draw.circle(self.s, wc, (cx, cy), 4, 1)
            pygame.draw.circle(self.s, wc, (cx, cy), 1)
        elif kind == 'horseshoe':
            pygame.draw.arc(self.s, wc, (cx - 4, cy - 4, 8, 9), 0, math.pi, 2)
            pygame.draw.line(self.s, wc, (cx - 4, cy), (cx - 4, cy + 3), 2)
            pygame.draw.line(self.s, wc, (cx + 3, cy), (cx + 3, cy + 3), 2)
        elif kind == 'anvil':
            pygame.draw.polygon(self.s, wc, [(cx - 5, cy - 2), (cx + 5, cy - 2), (cx + 2, cy + 1), (cx + 2, cy + 4),
                                             (cx - 2, cy + 4), (cx - 2, cy + 1)])
        elif kind == 'wheel':
            pygame.draw.circle(self.s, wc, (cx, cy), 4, 1)
            pygame.draw.line(self.s, wc, (cx - 4, cy), (cx + 4, cy), 1)
            pygame.draw.line(self.s, wc, (cx, cy - 4), (cx, cy + 4), 1)
        elif kind == 'crown':
            pygame.draw.polygon(self.s, wc, [(cx - 5, cy + 3), (cx - 5, cy - 2), (cx - 2, cy + 1), (cx, cy - 4),
                                             (cx + 2, cy + 1), (cx + 5, cy - 2), (cx + 5, cy + 3)])

    def logs(self, x, y, n=3):
        for i in range(n):
            cx, cy = self.P(x, y, 4 + i * 5)
            cx += (i % 2) * 5
            pygame.draw.ellipse(self.s, (130, 88, 50), (cx - 12, cy - 3, 20, 7))
            pygame.draw.ellipse(self.s, (195, 155, 105), (cx + 4, cy - 3, 6, 7))
            pygame.draw.ellipse(self.s, (90, 60, 35), (cx + 4, cy - 3, 6, 7), 1)

    def rocks(self, x, y, color, n=4):
        rnd = random.Random(int(x * 100 + y * 7))
        for i in range(n):
            cx, cy = self.P(x + rnd.uniform(-0.2, 0.2), y + rnd.uniform(-0.2, 0.2), 0)
            pygame.draw.ellipse(self.s, color, (cx - 6, cy - 7, 12, 9))
            pygame.draw.ellipse(self.s, shade(color, -60), (cx - 6, cy - 7, 12, 9), 1)


STONE = (182, 175, 160)
STONE_D = (160, 152, 138)
PLASTER = (214, 196, 160)
WOOD = (168, 124, 80)
ROOF_RED = (170, 68, 44)
ROOF_BROWN = (128, 82, 52)
ROOF_SLATE = (86, 90, 104)


def make_building_sprite(kind, color):
    """Возвращает (surface, ox, oy): (ox, oy) — где в спрайте верхний угол ромба основания."""
    d = BUILDINGS[kind]
    s = d['size']
    extra = d.get('art_h') or {'tower': 120, 'castle': 130, 'town_center': 110}.get(kind, 80)
    W = s * 2 * HW
    Hh = s * 2 * HH
    surf = pygame.Surface((W + 8, Hh + extra + 4), pygame.SRCALPHA)
    ox, oy = W // 2 + 4, extra
    p = IsoPainter(surf, ox, oy)
    # тень (сдвиг на восток)
    sh = pygame.Surface(surf.get_size(), pygame.SRCALPHA)
    ps = IsoPainter(sh, ox + 10, oy + 2)
    pygame.draw.polygon(sh, (0, 0, 0, 55), [ps.P(0.1, 0.1), ps.P(s - 0.1, 0.1), ps.P(s - 0.1, s - 0.1),
                                            ps.P(0.1, s - 0.1)])
    surf.blit(sh, (0, 0))

    art = d.get('art')
    if callable(art):
        # здание из контента рисует себя само: art(painter, surf, color, size)
        art(p, surf, color, s)
    elif kind == 'house':
        p.poly([(0.1, 0.1), (1.9, 0.1), (1.9, 1.9), (0.1, 1.9)], (150, 130, 95), outline=False)
        p.box(0.35, 0.35, 1.65, 1.65, 18, PLASTER, top=False, tex='timber')
        p.door(0.95, 1.65, 0.28, 12)
        p.window_r(1.65, 1.0, 8)
        p.gable(0.35, 0.35, 1.65, 1.65, 18, 20, ROOF_RED, PLASTER, axis='x')
        p.box(1.2, 0.6, 1.36, 0.76, 10, (120, 110, 100), z0=28)
        p.banner_l(0.55, 1.65, 17, color)
    elif kind == 'mill':
        p.box(0.4, 0.4, 1.6, 1.6, 26, STONE, top=False, tex='stone')
        p.door(1.0, 1.6, 0.3, 13)
        p.hip(0.4, 0.4, 1.6, 1.6, 26, 22, ROOF_BROWN)
        p.banner_l(0.6, 1.6, 24, color)
        hx, hy = p.P(1.6, 1.25, 30)
        for a in range(4):
            ang = math.pi / 4 + a * math.pi / 2 + 0.2
            ex, ey = hx + math.cos(ang) * 34, hy + math.sin(ang) * 34
            px, py = -math.sin(ang) * 7, math.cos(ang) * 7
            mx, my = hx + math.cos(ang) * 12, hy + math.sin(ang) * 12
            pygame.draw.polygon(surf, (236, 226, 200), [(mx, my), (ex, ey), (ex + px, ey + py), (mx + px, my + py)])
            pygame.draw.polygon(surf, (120, 95, 60), [(mx, my), (ex, ey), (ex + px, ey + py), (mx + px, my + py)], 1)
            pygame.draw.line(surf, (100, 72, 44), (hx, hy), (ex, ey), 2)
        pygame.draw.circle(surf, (80, 60, 40), (int(hx), int(hy)), 4)
    elif kind == 'lumber_camp':
        for (px_, py_) in ((0.3, 0.3), (1.3, 0.3), (0.3, 1.2), (1.3, 1.2)):
            p.box(px_, py_, px_ + 0.1, py_ + 0.1, 20, (110, 78, 48), top=False)
        p.box(0.3, 0.3, 1.4, 0.55, 20, WOOD, top=False, tex='wood')
        p.gable(0.3, 0.3, 1.4, 1.3, 20, 14, (122, 90, 56), WOOD, axis='x')
        p.logs(1.1, 1.6, 3)
        p.logs(0.5, 1.7, 2)
        p.banner_l(0.8, 1.3, 19, color)
    elif kind == 'mining_camp':
        for (px_, py_) in ((0.3, 0.3), (1.3, 0.3), (0.3, 1.2), (1.3, 1.2)):
            p.box(px_, py_, px_ + 0.1, py_ + 0.1, 18, (110, 78, 48), top=False)
        p.box(0.3, 0.3, 1.4, 0.55, 18, STONE_D, top=False, tex='stone')
        p.gable(0.3, 0.3, 1.4, 1.3, 18, 14, (112, 98, 84), STONE_D, axis='y')
        p.rocks(1.55, 1.2, (150, 150, 156), 4)
        p.rocks(1.2, 1.65, (232, 192, 48), 3)
        p.banner_l(0.8, 1.3, 17, color)
    elif kind == 'town_center':
        p.box(0.1, 0.1, 3.9, 3.9, 8, (164, 155, 138), tex=None)
        for (tx_, ty_) in ((0.25, 0.25),):
            p.box(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 52, STONE, z0=8, top=False, tex='stone')
            p.hip(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 60, 16, ROOF_SLATE, ov=0.06)
        for (tx_, ty_) in ((3.05, 0.25), (0.25, 3.05)):
            p.box(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 52, STONE, z0=8, top=False, tex='stone')
            p.hip(tx_, ty_, tx_ + 0.7, ty_ + 0.7, 60, 16, ROOF_SLATE, ov=0.06)
        p.box(0.8, 0.8, 3.2, 3.2, 36, PLASTER, z0=8, top=False, tex='timber')
        p.door(2.0, 3.2, 0.5, 20)
        for xm in (1.2, 2.8):
            p.window_l(xm, 3.2, 26)
        for ym in (1.4, 2.6):
            p.window_r(3.2, ym, 26)
        p.hip(0.8, 0.8, 3.2, 3.2, 44, 40, ROOF_BROWN, ov=0.15)
        p.banner_l(1.5, 3.2, 40, color, w=0.22, h=16)
        p.banner_l(2.5, 3.2, 40, color, w=0.22, h=16)
        p.box(3.05, 3.05, 3.75, 3.75, 52, STONE, z0=8, top=False, tex='stone')
        p.hip(3.05, 3.05, 3.75, 3.75, 60, 16, ROOF_SLATE, ov=0.06)
        p.flag(2.0, 2.0, 84, color, 22)
        p.emblem(2.0, 3.2, 30, color, 'crown')
    elif kind in ('barracks', 'blacksmith'):
        wall = STONE if kind == 'barracks' else (150, 140, 128)
        p.box(0.35, 0.35, 2.65, 2.65, 30, wall, top=False, tex='stone')
        p.door(1.5, 2.65, 0.45, 18)
        p.window_l(0.8, 2.65, 18)
        p.window_l(2.2, 2.65, 18)
        p.window_r(2.65, 1.0, 18)
        p.window_r(2.65, 2.0, 18)
        if kind == 'barracks':
            p.gable(0.35, 0.35, 2.65, 2.65, 30, 30, (140, 52, 44), wall, axis='y')
            p.emblem(1.5, 2.65, 38, color, 'swords')
            p.banner_l(0.6, 2.65, 28, color)
            p.banner_l(2.4, 2.65, 28, color)
        else:
            p.hip(0.35, 0.35, 2.65, 2.65, 30, 28, (72, 70, 78))
            p.box(1.9, 0.8, 2.2, 1.1, 24, (80, 74, 72), z0=40)
            cx, cy = p.P(2.05, 0.95, 66)
            for i in range(3):
                pygame.draw.circle(surf, (170, 170, 170, 110), (int(cx + i * 4), int(cy - i * 9)), 5 + i * 2)
            p.emblem(1.5, 2.65, 36, color, 'anvil')
            p.banner_l(0.6, 2.65, 28, color)
    elif kind == 'archery_range':
        p.box(0.3, 0.3, 2.7, 1.5, 26, WOOD, top=False, tex='wood')
        p.gable(0.3, 0.3, 2.7, 1.5, 26, 22, (82, 108, 60), WOOD, axis='x')
        p.emblem(1.5, 1.5, 22, color, 'target')
        for tx_ in (0.7, 1.5, 2.3):
            cx, cy = p.P(tx_, 2.5, 0)
            pygame.draw.line(surf, (110, 80, 50), (cx, cy), (cx, cy - 16), 2)
            pygame.draw.circle(surf, (230, 220, 190), (int(cx), int(cy - 20)), 7)
            pygame.draw.circle(surf, (200, 50, 45), (int(cx), int(cy - 20)), 4)
            pygame.draw.circle(surf, (240, 230, 200), (int(cx), int(cy - 20)), 1)
        p.banner_l(0.6, 1.5, 24, color)
    elif kind == 'stable':
        p.box(0.3, 0.3, 2.7, 1.6, 24, (176, 134, 88), top=False, tex='wood')
        p.gable(0.3, 0.3, 2.7, 1.6, 24, 22, (150, 108, 62), (176, 134, 88), axis='x')
        for i in range(3):
            p.door(0.8 + i * 0.7, 1.6, 0.35, 14, (70, 48, 30))
        # загон
        for t in (0.3, 1.0, 1.7, 2.4, 2.7):
            p.box(t - 0.03, 2.62, t + 0.03, 2.68, 10, (130, 95, 60), top=False)
        p.line((0.3, 2.65, 8), (2.7, 2.65, 8), (140, 100, 62), 2)
        p.line((0.3, 2.65, 4), (2.7, 2.65, 4), (140, 100, 62), 2)
        cx, cy = p.P(2.2, 2.1, 0)
        pygame.draw.ellipse(surf, (220, 190, 90), (cx - 10, cy - 8, 20, 10))
        p.emblem(1.5, 1.6, 20, color, 'horseshoe')
        p.banner_l(0.5, 1.6, 22, color)
    elif kind == 'tower':
        p.box(0.2, 0.2, 0.8, 0.8, 78, STONE, top=True, tex='stone')
        p.box(0.12, 0.12, 0.88, 0.88, 6, shade(STONE, 8), z0=78)
        p.crenels(0.12, 0.12, 0.88, 0.88, 84, STONE, step=0.25, sz=0.12)
        p.window_l(0.5, 0.8, 52, 0.1, 9)
        p.window_r(0.8, 0.5, 52, 0.1, 9)
        p.door(0.5, 0.8, 0.22, 12)
        p.banner_l(0.5, 0.8, 74, color, w=0.2, h=14)
        p.flag(0.5, 0.5, 90, color, 18)
    elif kind == 'siege_workshop':
        p.box(0.3, 0.3, 3.7, 3.0, 32, WOOD, top=False, tex='wood')
        p.door(2.0, 3.0, 1.0, 24, (64, 44, 28))
        p.gable(0.3, 0.3, 3.7, 3.0, 32, 30, (110, 86, 62), WOOD, axis='x')
        p.emblem(2.0, 3.0, 40, color, 'wheel')
        p.logs(3.2, 3.5, 3)
        p.banner_l(0.7, 3.0, 30, color)
        p.banner_l(3.3, 3.0, 30, color)
    elif kind == 'castle':
        T = 0.95
        corners = [(0.1, 0.1), (3.9 - T, 0.1), (0.1, 3.9 - T), (3.9 - T, 3.9 - T)]
        for (tx_, ty_) in corners[:3]:
            p.box(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, top=True, tex='stone')
            p.crenels(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, step=0.3)
        p.box(0.4, 0.4, 3.6, 3.6, 40, STONE_D, top=True, tex='stone')
        p.crenels(0.4, 0.4, 3.6, 3.6, 40, STONE_D, step=0.34)
        p.box(1.3, 1.3, 2.7, 2.7, 86, STONE, top=True, tex='stone', z0=0)
        p.crenels(1.3, 1.3, 2.7, 2.7, 86, STONE, step=0.3)
        p.banner_l(2.0, 2.7, 80, color, w=0.3, h=20)
        p.window_l(1.65, 2.7, 58, 0.1, 10)
        p.window_l(2.35, 2.7, 58, 0.1, 10)
        p.window_r(2.7, 2.0, 58, 0.1, 10)
        p.flag(2.0, 2.0, 92, color, 24)
        p.door(2.0, 3.6, 0.6, 22, (50, 38, 30))
        p.banner_l(1.1, 3.6, 36, color)
        p.banner_l(2.9, 3.6, 36, color)
        tx_, ty_ = corners[3]
        p.box(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, top=True, tex='stone')
        p.crenels(tx_, ty_, tx_ + T, ty_ + T, 58, STONE, step=0.3)
        p.banner_l(tx_ + T / 2, ty_ + T, 52, color)
    else:
        # типовое здание — для нового контента без собственной графики
        m = 0.3 if s > 1 else 0.15
        p.box(m, m, s - m, s - m, 12 + 8 * s, STONE, top=False, tex='stone')
        p.door(s / 2, s - m, 0.3 * s / 2, 12)
        p.gable(m, m, s - m, s - m, 12 + 8 * s, 10 + 6 * s, ROOF_RED, STONE, axis='x')
        p.banner_l(s / 2 - 0.3 * s / 2 - 0.1, s - m, 10 + 8 * s, color)
    return surf, ox, oy


def draw_farm(surf, ox, oy, size, prog, fill):
    """Ферма — ромб земли с бороздами; (ox, oy) — верхний угол основания."""
    p = IsoPainter(surf, ox, oy)
    soil = (122, 90, 56) if prog >= 1 else (150, 122, 86)
    p.poly([(0.05, 0.05), (size - 0.05, 0.05), (size - 0.05, size - 0.05), (0.05, size - 0.05)], soil, outline=False)
    rows = 8
    rnd = random.Random(7)
    for i in range(1, rows):
        t = size * i / rows
        p.line((t, 0.15, 0), (t, size - 0.15, 0), shade(soil, -28), 2)
        if prog >= 1 and fill > 0:
            for j in range(12):
                u = 0.2 + (size - 0.4) * j / 11
                if rnd.random() < 0.2 + 0.8 * fill:
                    x, y = p.P(t - 0.06, u, 0)
                    h = 3 + 4 * fill
                    pygame.draw.line(surf, (222, 196, 92) if fill > 0.3 else (140, 170, 70), (x, y), (x + 1, y - h), 2)
    pygame.draw.polygon(surf, (96, 70, 44), [p.P(0.05, 0.05), p.P(size - 0.05, 0.05), p.P(size - 0.05, size - 0.05),
                                             p.P(0.05, size - 0.05)], 2)


def draw_animal(surf, kind, x, y, face=(1.0, 0.0), anim=0.0, moving=False, dead=False, collar=None, k=1.0):
    hx = 1 if face[0] >= 0 else -1
    lw = max(1, int(2 * k))

    def P(a, b):
        return int(x + a * k), int(y + b * k)

    if dead:
        body = {'sheep': (225, 222, 210), 'deer': (150, 100, 60), 'boar': (80, 60, 45),
                'wolf': (110, 106, 100)}.get(kind, (120, 100, 80))
        shadow(surf, x - 11 * k, y - 4 * k, 22 * k, 7 * k)
        pygame.draw.ellipse(surf, body, (*P(-10, -6), int(20 * k), int(8 * k)))
        pygame.draw.ellipse(surf, (150, 40, 35), (*P(-4, -4), int(8 * k), int(4 * k)))
        pygame.draw.ellipse(surf, shade(body, -60), (*P(-10, -6), int(20 * k), int(8 * k)), 1)
        return
    ls = math.sin(anim) * 2 if moving else 0
    if kind == 'sheep':
        shadow(surf, x - 10 * k, y - 3 * k, 20 * k, 6 * k)
        for i, lx in enumerate((-5, -2, 3, 6)):
            o = ls if i % 2 else -ls
            pygame.draw.line(surf, (60, 55, 50), P(lx, -4), P(lx + o, 0), lw)
        wool = (236, 234, 224)
        for (bx, by, r) in ((-4, -9, 5), (0, -10, 5.5), (4, -9, 5), (0, -7, 5)):
            pygame.draw.circle(surf, shade(wool, -30), P(bx + 0.5, by + 1), int(r * k))
        for (bx, by, r) in ((-4, -9, 5), (0, -10, 5.5), (4, -9, 5), (0, -7, 5)):
            pygame.draw.circle(surf, wool, P(bx, by), int(r * k))
        pygame.draw.ellipse(surf, (70, 64, 60), (*P(7 * hx - 3, -12), int(6 * k), int(5 * k)))
        if collar:
            pygame.draw.circle(surf, collar, P(5 * hx, -9), max(1, int(2 * k)))
    elif kind == 'deer':
        c = (165, 110, 62)
        shadow(surf, x - 11 * k, y - 3 * k, 22 * k, 6 * k)
        for i, lx in enumerate((-6, -3, 4, 7)):
            o = ls if i % 2 else -ls
            pygame.draw.line(surf, shade(c, -50), P(lx, -8), P(lx + o, 0), lw)
        pygame.draw.ellipse(surf, c, (*P(-9, -13), int(18 * k), int(8 * k)))
        pygame.draw.ellipse(surf, (230, 215, 190), (*P(-9 * hx if hx < 0 else -9, -10), int(6 * k), int(3 * k)))
        pygame.draw.line(surf, c, P(7 * hx, -11), P(10 * hx, -18), max(2, int(3 * k)))
        pygame.draw.ellipse(surf, c, (*P(10 * hx - 3, -21), int(7 * k), int(5 * k)))
        pygame.draw.line(surf, (215, 200, 170), P(10 * hx, -21), P(8 * hx, -27), 1)
        pygame.draw.line(surf, (215, 200, 170), P(11 * hx, -21), P(14 * hx, -27), 1)
    elif kind == 'wolf':
        c = (118, 112, 104)
        shadow(surf, x - 11 * k, y - 3 * k, 22 * k, 6 * k)
        for i, lx in enumerate((-6, -3, 4, 7)):
            o = ls if i % 2 else -ls
            pygame.draw.line(surf, shade(c, -45), P(lx, -7), P(lx + o, 0), lw)
        pygame.draw.ellipse(surf, c, (*P(-9, -13), int(18 * k), int(7 * k)))
        pygame.draw.ellipse(surf, (178, 172, 160), (*P(-5, -9), int(10 * k), int(3 * k)))
        pygame.draw.line(surf, shade(c, -20), P(-8 * hx, -11), P(-14 * hx, -8), max(2, int(2 * k)))
        pygame.draw.polygon(surf, c, [P(6 * hx, -14), P(14 * hx, -12), P(10 * hx, -8), P(6 * hx, -9)])
        pygame.draw.polygon(surf, shade(c, -30), [P(7 * hx, -14), P(8 * hx, -18), P(10 * hx, -14)])
        pygame.draw.circle(surf, (230, 200, 60), P(10 * hx, -12), max(1, int(k)))
    elif kind == 'wolf':
        c = (122, 118, 110)
        shadow(surf, x - 11 * k, y - 3 * k, 22 * k, 6 * k)
        for i, lx in enumerate((-6, -3, 4, 7)):
            o = ls if i % 2 else -ls
            pygame.draw.line(surf, shade(c, -45), P(lx, -7), P(lx + o, 0), lw)
        pygame.draw.ellipse(surf, c, (*P(-9, -13), int(18 * k), int(7 * k)))
        pygame.draw.ellipse(surf, shade(c, 40), (*P(-6, -10), int(10 * k), int(3 * k)))
        pygame.draw.line(surf, shade(c, -20), P(-9 * hx, -11), P(-14 * hx, -7), max(2, int(2 * k)))     # хвост
        pygame.draw.polygon(surf, c, [P(7 * hx, -14), P(14 * hx, -12), P(8 * hx, -9)])                     # морда
        pygame.draw.polygon(surf, shade(c, -30), [P(7 * hx, -14), P(8 * hx, -18), P(10 * hx, -14)])       # ухо
    else:  # кабан
        c = (84, 64, 48)
        shadow(surf, x - 12 * k, y - 3 * k, 24 * k, 7 * k)
        for i, lx in enumerate((-6, -3, 4, 7)):
            o = ls if i % 2 else -ls
            pygame.draw.line(surf, shade(c, -30), P(lx, -5), P(lx + o, 0), max(2, int(3 * k)))
        pygame.draw.ellipse(surf, c, (*P(-11, -14), int(22 * k), int(11 * k)))
        for i in range(5):
            pygame.draw.line(surf, shade(c, -35), P(-6 + i * 3, -14), P(-7 + i * 3, -17), 1)
        pygame.draw.polygon(surf, shade(c, 10), [P(8 * hx, -12), P(15 * hx, -8), P(8 * hx, -5)])
        pygame.draw.line(surf, (240, 235, 220), P(12 * hx, -7), P(14 * hx, -11), 1)
