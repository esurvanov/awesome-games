"""Drawing of control markers (called from ui.Game with a single line):
group numbers above units and buildings, Shift-route and patrol flags, several rally points, signals to allies
(on the map and minimap), the order-mode hint, army button icons (stances, formations, orders).
Coordinates go only through Game.w2s / world_to_mm (no hard-coded tile size)."""
import math

import pygame

from . import i18n
from .data import TOP_H
from .world import Unit, Building
from . import orders

GROUP_BG = (28, 24, 18)
GROUP_FG = (255, 236, 170)
FLAG = (250, 250, 250)
PATROL = (120, 200, 255)
FLARE = (255, 220, 60)
MODE_TIPS = {m: 'ctl.mode.' + m for m in ('patrol', 'guard', 'follow', 'amove', 'aground', 'flare')}   # locale keys


# ============================================================ world
def draw_world_overlay(g):
    scr = g.screen
    w = g.world
    _groups(g, scr, w)
    _routes(g, scr, w)
    _rally_pts(g, scr)
    for (x, y, t, _o) in getattr(g, 'flares', ()):
        a = (w.time - t) % 1.0
        sx, sy = g.w2s(x, y)
        for k in (0.0, 0.5):
            r = int(6 + ((a + k) % 1.0) * 26)
            pygame.draw.ellipse(scr, FLARE, (sx - r, sy - r / 2, 2 * r, r), 2)
        pygame.draw.line(scr, (90, 70, 40), (sx, sy), (sx, sy - 26), 2)
        pygame.draw.polygon(scr, FLARE, [(sx, sy - 26), (sx + 14, sy - 21), (sx, sy - 16)])


def _groups(g, scr, w):
    groups = getattr(g, 'groups', None)
    if not groups:
        return
    view = scr.get_rect()
    for n, lst in groups.items():
        if not lst:
            continue
        label = str(n % 10) if n < 10 else f'{n - 10}'
        alt = n >= 10
        for e in lst:
            if not e.alive or e.owner != 0:
                continue
            if isinstance(e, Unit):
                sx, sy = g.w2s(e.x, e.y)
                if not view.collidepoint(sx, sy) or sy < TOP_H:
                    continue
                from .controls import unit_top_px
                top = unit_top_px(g, e)
                _badge(g, scr, sx + 16, sy - top + 2, label, alt)
            elif isinstance(e, Building):
                sx, sy = g.w2s(*e.center())
                if view.collidepoint(sx, sy) and sy >= TOP_H:
                    _badge(g, scr, sx + 20, sy - 40, label, alt)


def _badge(g, scr, x, y, label, alt):
    r = pygame.Rect(0, 0, 13, 13)
    r.center = (int(x), int(y))
    pygame.draw.rect(scr, GROUP_BG, r, border_radius=3)
    pygame.draw.rect(scr, (120, 200, 255) if alt else GROUP_FG, r, 1, border_radius=3)
    g.text(label, r.center, 's', GROUP_FG, anchor='center', sh=False)


def _flag(scr, sx, sy, col, n=None, g=None):
    pygame.draw.line(scr, (60, 48, 30), (sx, sy), (sx, sy - 16), 2)
    pygame.draw.polygon(scr, col, [(sx, sy - 16), (sx + 10, sy - 12), (sx, sy - 8)])
    pygame.draw.ellipse(scr, (30, 30, 30), (sx - 4, sy - 2, 8, 4), 1)


def _routes(g, scr, w):
    """Shift-route flags of the selected units (up to 10, as in DE): one flag per point - in the middle of the formation;
    the patrol loop."""
    units = [u for u in g.selected if isinstance(u, Unit) and u.owner == 0 and u.alive]
    seen = set()
    legs = []                       # i-th queue point -> [(x, y), ...] for all units
    for u in units:
        m = u.mission
        if m is not None and m[0] == 'patrol':
            ring = [g.w2s(*p) for p in m[1]]
            key = tuple((int(p[0]) // 24, int(p[1]) // 24) for p in ring)
            if key in seen:
                continue
            seen.add(key)
            if len(ring) > 1:
                pygame.draw.lines(scr, PATROL, True, ring, 1)
            for p in ring:
                _flag(scr, int(p[0]), int(p[1]), PATROL)
            continue
        i = 0
        for it in (u.orders or ())[:orders.FLAGS_SHOWN]:
            if it[0] in ('move', 'amove', 'aground'):
                pt = (it[1], it[2])
            elif len(it) > 1 and hasattr(it[1], 'center') and it[1].alive:
                pt = it[1].center()
            else:
                continue
            if len(legs) <= i:
                legs.append([])
            legs[i].append(pt)
            i += 1
    if not legs:
        return
    n = len(units)
    prev = g.w2s(sum(u.x for u in units) / n, sum(u.y for u in units) / n)
    for pts in legs:
        c = g.w2s(sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        pygame.draw.line(scr, (230, 230, 230), prev, c, 1)
        _flag(scr, int(c[0]), int(c[1]), FLAG)
        prev = c


def _rally_pts(g, scr):
    for s in g.selected:
        pts = getattr(s, 'rally_pts', None)
        if not (isinstance(s, Building) and s.owner == 0 and pts and s.rally is not None):
            continue
        chain = [g.w2s(*s.center())] + [g.w2s(*p) for p in pts]
        r = s.rally
        chain.append(g.w2s(*(r if isinstance(r, tuple) else r.center())))
        pygame.draw.lines(scr, (255, 230, 120), False, chain, 1)
        for p in chain[1:-1]:
            _flag(scr, int(p[0]), int(p[1]), g.pcolor(0))


# ============================================================ panel
def draw_panel_overlay(g):
    scr = g.screen
    w = g.world
    for (x, y, t, _o) in getattr(g, 'flares', ()):
        a = (w.time - t) % 0.8 / 0.8
        mx, my = g.world_to_mm(x, y)
        pygame.draw.circle(scr, FLARE, (int(mx), int(my)), int(3 + a * 9), 2)
    mode = getattr(g, 'order_mode', None)
    if mode:
        tip = i18n.t(MODE_TIPS[mode]) if mode in MODE_TIPS else ''
        img = g.fonts['m'].render(tip, True, (255, 240, 200))
        r = img.get_rect(midtop=(scr.get_width() // 2, TOP_H + 8)).inflate(16, 8)
        pygame.draw.rect(scr, (20, 16, 12), r, border_radius=6)
        pygame.draw.rect(scr, (200, 170, 100), r, 1, border_radius=6)
        scr.blit(img, img.get_rect(center=r.center))


# ============================================================ army button icons
# DE: orders - a figure of our soldier in a pose (tools/build_portraits.py --orders); stances - in an octagonal
# frame (the active one is green); formations - white balls and a red "roof" (the selected one has green balls)
CTL_ART = {
    'patrol': 'portraits/orders/patrol.png', 'guard': 'portraits/orders/guard.png',
    'follow': 'portraits/orders/follow.png', 'amove': 'portraits/orders/amove.png',
    'aground': 'portraits/de/aground.png',
    'aggressive': 'portraits/de/stance_aggressive.png', 'defensive': 'portraits/de/stance_defensive.png',
    'stand_ground': 'portraits/orders/stand_ground.png', 'no_attack': 'portraits/de/stance_no_attack.png',
}
STANCES = ('aggressive', 'defensive', 'stand_ground', 'no_attack')


def _ctl_art(ic, name, active, size):
    """An icon from the built graphics; False - no files (draw procedurally)."""
    from . import uiskin as S
    if name in orders.FORMATIONS:
        art = S.icon(f'portraits/de/form_{name}{"_on" if active else ""}.png', size)
    else:
        art = S.icon(CTL_ART.get(name, ''), size) if name in CTL_ART else None
    if art is None:
        return False
    ic.blit(art, art.get_rect(center=(size // 2, size // 2)))
    if name in STANCES:
        fr = S.icon(f'portraits/de/oct{"_on" if active else ""}.png', size)
        if fr is not None:
            ic.blit(fr, (0, 0))
    elif active and name not in orders.FORMATIONS:
        pygame.draw.rect(ic, (110, 230, 110), ic.get_rect(), max(2, size // 20))
    return True


def draw_ctl_icon(ic, name, size):
    active = name.endswith('*')
    name = name.rstrip('*')
    if _ctl_art(ic, name, active, size):
        return ic
    s = size / 40
    c = size / 2
    bg = {'aggressive': (140, 40, 30), 'defensive': (60, 90, 140), 'stand_ground': (120, 100, 50),
          'no_attack': (70, 70, 70)}.get(name, (58, 70, 52) if name in orders.FORMATIONS else (80, 60, 40))
    pygame.draw.rect(ic, bg, (2, 2, size - 4, size - 4), border_radius=int(6 * s))
    pygame.draw.rect(ic, (255, 215, 90) if active else _sh(bg, 50), (2, 2, size - 4, size - 4),
                     max(1, int((3 if active else 1) * s)), border_radius=int(6 * s))
    wht = (240, 235, 220)
    steel = (210, 215, 225)

    def P(x, y):
        return (c + x * s, c + y * s)

    def sword(x0, y0, x1, y1, col=steel, wdt=3):
        pygame.draw.line(ic, col, P(x0, y0), P(x1, y1), max(2, int(wdt * s)))
        mx, my = x0 + (x1 - x0) * 0.8, y0 + (y1 - y0) * 0.8
        dx, dy = y1 - y0, -(x1 - x0)
        dl = math.hypot(dx, dy) or 1
        dx, dy = dx / dl * 5, dy / dl * 5
        pygame.draw.line(ic, (190, 150, 60), P(mx - dx, my - dy), P(mx + dx, my + dy), max(2, int(3 * s)))

    def shield(x, y, r, col=(90, 130, 200)):
        pts = [P(x - r, y - r), P(x + r, y - r), P(x + r, y + r * 0.2), P(x, y + r * 1.2), P(x - r, y + r * 0.2)]
        pygame.draw.polygon(ic, col, pts)
        pygame.draw.polygon(ic, wht, pts, max(1, int(1.5 * s)))

    def dots(pts):
        for (x, y) in pts:
            pygame.draw.circle(ic, wht, P(x, y), max(2, int(2.6 * s)))

    if name == 'aggressive':
        sword(-11, 11, 11, -11)
        sword(11, 11, -11, -11)
    elif name == 'defensive':
        shield(-3, -2, 9)
        sword(4, 12, 13, -10)
    elif name == 'stand_ground':
        pygame.draw.line(ic, (70, 50, 30), P(-2, 13), P(-2, -13), max(2, int(3 * s)))
        pygame.draw.polygon(ic, (220, 60, 50), [P(-2, -13), P(12, -8), P(-2, -3)])
        pygame.draw.line(ic, wht, P(-12, 13), P(10, 13), max(2, int(2 * s)))
    elif name == 'no_attack':
        sword(-10, 10, 10, -10)
        pygame.draw.circle(ic, (230, 60, 50), P(0, 0), 14 * s, max(2, int(3 * s)))
        pygame.draw.line(ic, (230, 60, 50), P(-10, -10), P(10, 10), max(2, int(3 * s)))
    elif name == 'patrol':
        for x in (-10, 10):
            pygame.draw.line(ic, (70, 50, 30), P(x, 12), P(x, -8), max(2, int(2 * s)))
            pygame.draw.polygon(ic, PATROL, [P(x, -12), P(x + 8, -9), P(x, -6)])
        pygame.draw.line(ic, wht, P(-7, 4), P(7, 4), max(2, int(2 * s)))
        pygame.draw.polygon(ic, wht, [P(8, 4), P(3, 0), P(3, 8)])
        pygame.draw.polygon(ic, wht, [P(-8, 4), P(-3, 0), P(-3, 8)])
    elif name == 'guard':
        shield(0, -2, 11, (200, 170, 70))
        pygame.draw.circle(ic, wht, P(0, -1), 3 * s)
    elif name == 'follow':
        for i, x in enumerate((-10, 0, 10)):
            pygame.draw.circle(ic, wht if i < 2 else (120, 230, 120), P(x, 4 - i * 4), max(2, int(3.5 * s)))
        pygame.draw.polygon(ic, (120, 230, 120), [P(14, -10), P(6, -10), P(12, -3)])
    elif name == 'amove':
        sword(-12, 10, 6, -8)
        pygame.draw.polygon(ic, (255, 120, 90), [P(13, -13), P(3, -12), P(12, -3)])
        pygame.draw.line(ic, (255, 120, 90), P(-4, 12), P(12, 12), max(2, int(2 * s)))
    elif name == 'aground':
        pygame.draw.ellipse(ic, (140, 110, 70), (c - 14 * s, c + 4 * s, 28 * s, 10 * s))
        pygame.draw.circle(ic, (230, 70, 50), P(0, 0), 11 * s, max(2, int(2 * s)))
        pygame.draw.line(ic, (230, 70, 50), P(-14, 0), P(14, 0), max(1, int(2 * s)))
        pygame.draw.line(ic, (230, 70, 50), P(0, -14), P(0, 14), max(1, int(2 * s)))
    elif name == 'line':
        dots([(x, y) for y in (-6, 6) for x in (-12, -4, 4, 12)])
    elif name == 'box':
        dots([(x, y) for x in (-10, 0, 10) for y in (-10, 0, 10) if (x, y) != (0, 0)])
        pygame.draw.circle(ic, (255, 200, 120), P(0, 0), max(2, int(2.6 * s)))
    elif name == 'staggered':
        dots([(-12, -7), (0, -7), (12, -7), (-6, 7), (6, 7)])
    elif name == 'flank':
        dots([(-14, -6), (-7, -6), (-14, 6), (-7, 6), (7, -6), (14, -6), (7, 6), (14, 6)])
    return ic


def _sh(c, d):
    return tuple(max(0, min(255, v + d)) for v in c)
