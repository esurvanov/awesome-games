"""Simple menu screen elements in the spirit of AoE2 DE (drawn by code - without Microsoft art):
a red button with a golden edge, a dropdown field, a checkbox, a tab, a slider, a heading plate.
"""
import pygame

from . import uiskin as S

RED = (128, 22, 16)
RED_HI = (168, 40, 28)
RED_DK = (70, 10, 8)
PAPER = (222, 200, 156)
PAPER_DK = (196, 170, 122)
INK = (52, 32, 14)
GOLD = S.GOLD
_cache = {}


def _grad(size, top, bot):
    key = ('g', size, top, bot)
    g = _cache.get(key)
    if g is None:
        w, h = size
        g = pygame.Surface(size)
        for y in range(h):
            t = y / max(1, h - 1)
            pygame.draw.line(g, tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)), (0, y), (w, y))
        if len(_cache) > 400:
            _cache.clear()
        _cache[key] = g
    return g


def red_button(surf, rect, label, f, state='normal', icon=None):
    """A DE button: burgundy, with a golden edge; state: normal | hover | pressed | disabled | on."""
    r = pygame.Rect(rect)
    if state == 'disabled':
        top, bot = (96, 84, 78), (60, 52, 48)
    elif state in ('hover', 'on'):
        top, bot = (190, 52, 36), (112, 20, 14)
    elif state == 'pressed':
        top, bot = (100, 16, 10), (140, 30, 22)
    else:
        top, bot = (156, 34, 24), (92, 14, 10)
    surf.blit(_grad(r.size, top, bot), r.topleft)
    pygame.draw.rect(surf, (24, 8, 4), r.inflate(2, 2), 1)
    pygame.draw.rect(surf, (230, 184, 96) if state != 'disabled' else (150, 140, 120), r, 1)
    pygame.draw.rect(surf, (90, 50, 20), r.inflate(-4, -4), 1)
    if state == 'on':
        pygame.draw.rect(surf, S.GOLD_HI, r.inflate(4, 4), 2)
    col = (255, 240, 205) if state != 'disabled' else (190, 180, 165)
    x = r.centerx
    avail = r.w - 16
    if icon:
        S.blit_icon(surf, icon, (r.x + r.h // 2 + 4, r.centery), r.h - 12)
        x += r.h // 3
        avail -= r.h + 4
    S.text_fit(surf, label, (x, r.centery), f, col, anchor='center', shadow=(30, 8, 4), max_w=avail)


def field(surf, rect, label, f, hover=False, arrow=True, color=INK, enabled=True):
    """A dropdown field: a light plate, text on the left, a diamond arrow on the right."""
    r = pygame.Rect(rect)
    surf.blit(_grad(r.size, (238, 222, 186) if hover else (226, 208, 168), (206, 184, 140)), r.topleft)
    pygame.draw.rect(surf, (120, 92, 52), r, 1)
    pygame.draw.line(surf, (255, 246, 220), (r.x + 1, r.y + 1), (r.right - 2, r.y + 1))
    if not enabled:
        S.shade_overlay(surf, r, (120, 110, 100), 110)
    S.text_fit(surf, label, (r.x + 8, r.centery), f, color if enabled else (110, 96, 80), anchor='midleft', shadow=None,
               max_w=r.w - 12 - (20 if arrow else 0))
    if arrow:
        cx, cy = r.right - 13, r.centery
        pts = [(cx - 6, cy - 3), (cx + 6, cy - 3), (cx, cy + 4)]
        pygame.draw.polygon(surf, (90, 60, 28), pts)
        pygame.draw.polygon(surf, (40, 24, 10), pts, 1)


def dropdown_list(surf, anchor, items, f, cur=None, hover_i=None, row_h=24, max_h=None):
    """An open list under the anchor field (or above it if it does not fit). items - captions.
    Returns [(rect, index)]."""
    a = pygame.Rect(anchor)
    h = row_h * len(items) + 4
    y = a.bottom
    sh = surf.get_height()
    if y + h > sh - 6:
        y = max(6, a.y - h)
    box = pygame.Rect(a.x, y, max(a.w, 120), h)
    pygame.draw.rect(surf, (20, 12, 6), box.move(3, 3))
    pygame.draw.rect(surf, (238, 224, 190), box)
    pygame.draw.rect(surf, (110, 70, 30), box, 2)
    out = []
    for i, lbl in enumerate(items):
        r = pygame.Rect(box.x + 2, box.y + 2 + i * row_h, box.w - 4, row_h)
        if i == hover_i:
            pygame.draw.rect(surf, RED_HI, r)
            col = (255, 240, 210)
        elif i == cur:
            pygame.draw.rect(surf, (214, 190, 140), r)
            col = INK
        else:
            col = INK
        S.text_fit(surf, lbl, (r.x + 8, r.centery), f, col, anchor='midleft', shadow=None, max_w=r.w - 12)
        out.append((r, i))
    return out


def list_rects(surf_h, anchor, n, row_h=24):
    """The same rectangles that dropdown_list draws (for clicks without drawing)."""
    a = pygame.Rect(anchor)
    h = row_h * n + 4
    y = a.bottom
    if y + h > surf_h - 6:
        y = max(6, a.y - h)
    w = max(a.w, 120)
    return [(pygame.Rect(a.x + 2, y + 2 + i * row_h, w - 4, row_h), i) for i in range(n)]


def checkbox(surf, rect, on, label, f, hover=False, color=INK):
    r = pygame.Rect(rect)
    b = pygame.Rect(r.x, r.centery - 8, 16, 16)
    pygame.draw.rect(surf, (236, 222, 190) if not hover else (250, 240, 214), b)
    pygame.draw.rect(surf, (90, 60, 28), b, 1)
    if on:
        pygame.draw.lines(surf, (170, 24, 16), False, [(b.x + 3, b.y + 8), (b.x + 7, b.y + 12), (b.x + 13, b.y + 3)], 3)
    S.text_fit(surf, label, (b.right + 8, r.centery), f, color, anchor='midleft', shadow=None, max_w=r.right - b.right - 8)


def tab(surf, rect, label, f, on, hover=False, icon=None):
    r = pygame.Rect(rect)
    top, bot = ((236, 216, 172), (214, 190, 140)) if on else (((150, 40, 28), (96, 18, 12)) if hover else
                                                                ((120, 30, 20), (74, 12, 8)))
    surf.blit(_grad(r.size, top, bot), r.topleft)
    pygame.draw.rect(surf, (230, 184, 96), r, 1)
    col = INK if on else (250, 232, 200)
    x = r.centerx
    avail = r.w - 12
    if icon:
        S.blit_icon(surf, icon, (r.x + 20, r.centery), 22)
        x += 10
        avail -= 44
    S.text_fit(surf, label, (x, r.centery), f, col, anchor='center', shadow=None if on else (20, 6, 2), max_w=avail)


def slider(surf, rect, v, hover=False):
    """A 0...1 slider: a track and a handle. Returns the track (for clicks)."""
    r = pygame.Rect(rect)
    tr = pygame.Rect(r.x, r.centery - 4, r.w, 8)
    pygame.draw.rect(surf, (70, 50, 30), tr, border_radius=4)
    pygame.draw.rect(surf, (200, 60, 40), (tr.x, tr.y, int(tr.w * v), tr.h), border_radius=4)
    pygame.draw.rect(surf, (30, 18, 8), tr, 1, border_radius=4)
    kx = tr.x + int(tr.w * v)
    pygame.draw.circle(surf, (30, 18, 8), (kx + 1, tr.centery + 1), 10)
    pygame.draw.circle(surf, (240, 206, 130) if hover else (214, 176, 100), (kx, tr.centery), 10)
    pygame.draw.circle(surf, (110, 70, 28), (kx, tr.centery), 10, 2)
    return tr


def plate(surf, center, text, f, w=None):
    """A screen heading plate (like "Standard Game" in DE): a light ribbon with ornaments on the sides."""
    if w:
        f, text = S.fit_text(f, text, w - 24)
    img = f.render(text, True, INK)
    w = w or img.get_width() + 120
    r = pygame.Rect(0, 0, w, img.get_height() + 16)
    r.center = center
    surf.blit(_grad(r.size, (246, 234, 204), (216, 196, 150)), r.topleft)
    pygame.draw.rect(surf, (120, 84, 40), r, 2)
    pygame.draw.rect(surf, (250, 240, 214), r.inflate(-6, -6), 1)
    for side in (-1, 1):
        x0 = r.left - 10 if side < 0 else r.right + 10
        x1 = x0 + side * 90
        pygame.draw.line(surf, (120, 84, 40), (x0, r.centery), (x1, r.centery), 3)
        pygame.draw.circle(surf, (170, 40, 26), (x1, r.centery), 5)
        pygame.draw.circle(surf, (120, 84, 40), (x1, r.centery), 5, 1)
    surf.blit(img, img.get_rect(center=r.center))
    return r


def box(surf, rect, alpha=70):
    """A nested frame on parchment (the players / parameters block)."""
    r = pygame.Rect(rect)
    S.shade_overlay(surf, r, (90, 60, 20), alpha)
    pygame.draw.rect(surf, (120, 84, 40), r, 2)
    pygame.draw.rect(surf, (240, 222, 180), r.inflate(-6, -6), 1)


def color_badge(surf, rect, color, num, f, hover=False):
    r = pygame.Rect(rect)
    pygame.draw.rect(surf, (20, 12, 6), r.inflate(2, 2))
    pygame.draw.rect(surf, color, r)
    pygame.draw.rect(surf, (255, 255, 255) if hover else (230, 210, 170), r, 2)
    S.text(surf, str(num), r.center, f, (255, 255, 255), anchor='center', shadow=(0, 0, 0))
