"""Процедурная графика цивилизаций: уникальные юниты (обычные и элитные) и гербы.

Всё рисуется кодом (pygame.draw) — никаких чужих изображений. Функции юнитов возвращают art с сигнатурой
UNITS[kind]['art']: art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving).
Гербы — draw_emblem(surf, rect, spec): щит с делением поля и фигурой (spec — CIVS[civ]['emblem']).
"""
import math
import os

os.environ.setdefault('PYGAME_HIDE_SUPPORT_PROMPT', '1')
import pygame  # noqa: E402

from .data import shade  # noqa: E402

SKIN = (232, 190, 145)
IRON = (160, 162, 175)
IRON_D = (105, 106, 118)
STEEL = (220, 222, 232)
WOOD = (125, 88, 52)
WOOD_D = (88, 62, 38)
GOLD = (236, 196, 70)
FUR = (120, 86, 52)
WHITE = (238, 234, 222)


def _P(x, y, k, bob):
    def P(a, b, bb=True):
        return int(x + a * k), int(y + b * k + (bob if bb else 0))
    return P


def _shadow(surf, x, y, w, h):
    from . import gfx
    gfx.shadow(surf, x, y, w, h)


def _poly(surf, c, pts, outline=None):
    pygame.draw.polygon(surf, c, pts)
    if outline:
        pygame.draw.polygon(surf, outline, pts, 1)


# ============================================================ пеший
def _foot(surf, color, x, y, face, anim, k, moving, skin=SKIN, torso=None, legs=None, sc=1.0):
    """Тело пешего воина (ноги, торс, голова). Возвращает (P, hx) — точки уже с учётом масштаба sc."""
    hx = 1 if face[0] >= 0 else -1
    bob = math.sin(anim) * 1.0 * k if moving else 0
    kk = k * sc
    P = _P(x, y, kk, bob)
    lw = max(1, int(2 * kk))
    _shadow(surf, x - 7 * kk, y - 2 * kk, 14 * kk, 5 * kk)
    ls = math.sin(anim) * 2.2 if moving else 0
    lc = legs or shade(color, -90)
    pygame.draw.line(surf, lc, P(-2, -4), P(-2 + ls, 1, False), lw)
    pygame.draw.line(surf, lc, P(2, -4), P(2 - ls, 1, False), lw)
    tc = torso or color
    pygame.draw.circle(surf, tc, P(0, -8), int(5.5 * kk))
    pygame.draw.circle(surf, shade(tc, -80), P(0, -8), int(5.5 * kk), 1)
    pygame.draw.circle(surf, skin, P(0, -15), int(3.4 * kk))
    return P, hx, kk


def _round_shield(surf, P, hx, kk, color, big=False, front=False, pattern=None):
    sx, sy = P((3 if front else -5) * hx, -9)
    r = int((5.2 if big else 3.8) * kk)
    pygame.draw.circle(surf, color, (sx, sy), max(2, r))
    if pattern == 'quarter':
        pygame.draw.line(surf, WHITE, (sx - r, sy), (sx + r, sy), max(1, int(kk)))
        pygame.draw.line(surf, WHITE, (sx, sy - r), (sx, sy + r), max(1, int(kk)))
    elif pattern == 'spiral':
        pygame.draw.arc(surf, WHITE, (sx - r // 2, sy - r // 2, r, r), 0, 4.5, max(1, int(kk)))
    pygame.draw.circle(surf, (120, 90, 55), (sx, sy), max(2, r), max(1, int(kk)))
    pygame.draw.circle(surf, STEEL, (sx, sy), max(1, int(1.3 * kk)))


def axeman(elite):
    """Метатель топоров: шлем с наносником, франциска в поднятой руке, запасной топор на поясе."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving)
        lw = max(1, int(2 * kk))
        if elite:
            _round_shield(surf, P, hx, kk, shade(color, -25), pattern='quarter')
        # пояс и запасной топорик
        pygame.draw.line(surf, (90, 60, 35), P(-4.5, -5), P(4.5, -5), max(1, int(1.5 * kk)))
        pygame.draw.line(surf, WOOD, P(-2 * hx, -5), P(-3 * hx, -1), lw)
        pygame.draw.polygon(surf, STEEL, [P(-3 * hx, -2), P(-5.5 * hx, -3), P(-5 * hx, 0)])
        # шлем
        pygame.draw.ellipse(surf, IRON, (*P(-3.8, -20), int(7.6 * kk), int(5.8 * kk)))
        pygame.draw.line(surf, IRON_D, P(1.6 * hx, -17), P(1.6 * hx, -13.5), max(1, int(1.2 * kk)))
        if elite:
            pygame.draw.line(surf, shade(color, 50), P(-3 * hx, -20.5), P(2 * hx, -21.5), max(2, int(2 * kk)))
        # рука с топором: замах назад → бросок вперёд
        s = swing / 0.3 if swing > 0 else 0
        hand = P((3 - 6 * (1 - s)) * hx if s < 0.5 else 6 * hx, -13 + 5 * s)
        sh = P(2 * hx, -10)
        pygame.draw.line(surf, SKIN, sh, hand, lw)
        if s < 0.5:
            hx0, hy0 = hand
            top = (hx0 - int(1 * kk * hx), hy0 - int(9 * kk))
            pygame.draw.line(surf, WOOD, hand, top, lw)
            tx, ty = top
            blade = [(tx, ty - int(0.5 * kk)), (tx + int(5.5 * kk * hx), ty - int(2.5 * kk)),
                     (tx + int(6 * kk * hx), ty + int(3.5 * kk)), (tx, ty + int(2.5 * kk))]
            pygame.draw.polygon(surf, STEEL, blade)
            pygame.draw.polygon(surf, IRON_D, blade, 1)
    return art


def longbow(elite):
    """Длинный лук: капюшон, лук выше человека, колчан за спиной."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving, torso=(96, 120, 64) if not elite else None)
        lw = max(1, int(2 * kk))
        # колчан
        pygame.draw.line(surf, (110, 70, 40), P(-4 * hx, -14), P(-6 * hx, -4), max(2, int(3 * kk)))
        for i in range(3):
            pygame.draw.line(surf, WHITE, P((-4 - i * 0.6) * hx, -14 - i * 0.3), P((-3.5 - i * 0.6) * hx, -16.5),
                             1)
        if elite:
            # стёганка поверх: пояс в цвет, шапель
            pygame.draw.line(surf, shade(color, -50), P(-4.5, -6), P(4.5, -6), max(1, int(1.5 * kk)))
            pygame.draw.ellipse(surf, IRON, (*P(-5.5, -18.5), int(11 * kk), int(3.2 * kk)))
            pygame.draw.ellipse(surf, IRON_D, (*P(-3, -21), int(6 * kk), int(4 * kk)))
        else:
            # капюшон в цвет игрока с хвостом
            pygame.draw.ellipse(surf, shade(color, -30), (*P(-4, -20), int(8 * kk), int(6 * kk)))
            pygame.draw.line(surf, shade(color, -30), P(-3 * hx, -17), P(-6 * hx, -13), max(1, int(2 * kk)))
        # высокий лук: от колена до макушки и выше
        s = swing / 0.3 if swing > 0 else 0
        bx, by = P((7 + s) * hx, -12)
        r = pygame.Rect(0, 0, int((8 - 2 * s) * kk), int(30 * kk))
        r.center = (bx, by)
        a0 = -math.pi / 2 if hx > 0 else math.pi / 2
        pygame.draw.arc(surf, (140, 92, 44), r, a0, a0 + math.pi, lw)
        sx = bx - int((2 + 3 * (1 - s)) * kk * hx)
        pygame.draw.line(surf, (230, 230, 225), (bx, r.top), (sx, by), 1)
        pygame.draw.line(surf, (230, 230, 225), (bx, r.bottom), (sx, by), 1)
        pygame.draw.line(surf, SKIN, P(2 * hx, -10), (sx, by), max(1, int(1.5 * kk)))
    return art


def _rider_pts(x, y, k, anim, moving, camel=False):
    bob = math.sin(anim) * 1.0 * k if moving else 0
    legh = 5 if camel else 3
    by = -11 - (legh - 3)
    ry = by - 4
    return _P(x, y, k, bob), by, ry, ry - 6


def mangudai(elite):
    """Мангудай: низкорослая степная лошадка, меховая шапка с цветным верхом, лук."""
    from .content import _army_art as aa
    base = aa.rider(horse=(176, 140, 90) if not elite else (150, 118, 80), bard='cloth' if elite else None,
                    head='skin', weapon='bow')

    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
        hx = 1 if face[0] >= 0 else -1
        P, by, ry, hy = _rider_pts(x, y, k, anim, moving)
        # грива
        pygame.draw.line(surf, (60, 44, 30), P(9 * hx, by - 4), P(12 * hx, by - 6), max(1, int(2 * k)))
        # шапка: цветной конус и меховой околыш
        _poly(surf, shade(color, 10), [P(-2.8, hy - 2), P(0.5 * hx, hy - 8.5), P(2.8, hy - 2)])
        pygame.draw.ellipse(surf, FUR, (*P(-4.2, hy - 3.6), int(8.4 * k), int(3.4 * k)))
        pygame.draw.ellipse(surf, shade(FUR, -40), (*P(-4.2, hy - 3.6), int(8.4 * k), int(3.4 * k)), 1)
        if elite:
            pygame.draw.circle(surf, GOLD, P(0.5 * hx, hy - 8.5), max(1, int(1.3 * k)))
            pygame.draw.line(surf, (245, 245, 240), P(0.5 * hx, hy - 8.5), P(-3 * hx, hy - 12), max(1, int(k)))
    return art


def cataphract(elite):
    """Катафракт: конь в чешуйчатой броне до колен, всадник в остроконечном шлеме с бармицей, копьё."""
    from .content import _army_art as aa
    base = aa.rider(horse=(84, 74, 68), bard='plate', head='helm', weapon='lance', big=elite)

    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
        hx = 1 if face[0] >= 0 else -1
        P, by, ry, hy = _rider_pts(x, y, k, anim, moving)
        sc = 1.1 if elite else 1.0
        scale = GOLD if elite else (190, 192, 204)
        # чешуя на корпусе и груди коня
        for row in range(2):
            for i in range(-4, 5):
                cx, cy = P(i * 2.1 * sc, by + 3 + row * 2.6)
                pygame.draw.arc(surf, scale, (cx - int(1.3 * k), cy - int(1.3 * k), int(2.6 * k), int(2.6 * k)),
                                math.pi, 2 * math.pi, 1)
        # чешуйчатый нагрудник у шеи
        _poly(surf, shade(color, -30), [P(7 * hx * sc, by + 1), P(12 * hx * sc, by - 4), P(13 * hx * sc, by + 2),
                                        P(9 * hx * sc, by + 6)], scale)
        # всадник: чешуйчатая броня на торсе, шлем-шишак с бармицей
        for i in (-2.5, 0, 2.5):
            pygame.draw.arc(surf, scale, (*P(i - 1.3, ry - 1), int(2.6 * k), int(2.6 * k)), math.pi, 2 * math.pi, 1)
        _poly(surf, IRON, [P(-3.3, hy - 1), P(0, hy - 7), P(3.3, hy - 1)], IRON_D)
        pygame.draw.line(surf, IRON_D, P(-3.2, hy + 1), P(-3.2, hy + 3), max(1, int(1.5 * k)))
        pygame.draw.line(surf, IRON_D, P(3.2, hy + 1), P(3.2, hy + 3), max(1, int(1.5 * k)))
        if elite:
            pygame.draw.line(surf, shade(color, 60), P(0, hy - 7), P(-3 * hx, hy - 11), max(2, int(2 * k)))
    return art


def teutonic(elite):
    """Тевтонский рыцарь: полный доспех, ведёрный шлем, сюрко в цвет игрока с крестом, двуручный меч."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        sc = 1.12 if elite else 1.06
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving, torso=IRON, legs=IRON_D, sc=sc)
        lw = max(1, int(2 * kk))
        if elite:
            _poly(surf, WHITE, [P(-4 * hx, -13), P(-9 * hx, 0, False), P(-2 * hx, -2)], (150, 150, 150))
        # сюрко
        _poly(surf, color, [P(-3.6, -12), P(3.6, -12), P(4.6, -2), P(-4.6, -2)], shade(color, -80))
        cc = WHITE if sum(color) < 360 else (30, 30, 34)
        pygame.draw.line(surf, cc, P(0, -11), P(0, -4), max(1, int(1.6 * kk)))
        pygame.draw.line(surf, cc, P(-2.5, -8.5), P(2.5, -8.5), max(1, int(1.6 * kk)))
        # наплечники
        for sx in (-4.5, 4.5):
            pygame.draw.circle(surf, IRON, P(sx, -11.5), max(1, int(2.2 * kk)))
        # ведёрный шлем
        pygame.draw.rect(surf, IRON, (*P(-3.9, -20.5), int(7.8 * kk), int(7.5 * kk)),
                         border_radius=max(1, int(1.5 * kk)))
        pygame.draw.rect(surf, IRON_D, (*P(-3.9, -20.5), int(7.8 * kk), int(7.5 * kk)), 1,
                         border_radius=max(1, int(1.5 * kk)))
        pygame.draw.line(surf, (30, 30, 36), P(-2.5 + hx, -17), P(2.5 + hx, -17), max(1, int(kk)))
        pygame.draw.line(surf, (30, 30, 36), P(1 * hx, -17), P(1 * hx, -14.5), max(1, int(kk)))
        if elite:
            # корона-навершие
            _poly(surf, GOLD, [P(-3.5, -20.5), P(-3, -23.5), P(-1.2, -21.5), P(0, -24.5), P(1.2, -21.5),
                               P(3, -23.5), P(3.5, -20.5)])
        # двуручный меч
        s = swing / 0.3 if swing > 0 else 0
        hand = P(5 * hx, -8)
        tip = P((16 + s * 5) * hx, -27 + s * 19)
        pygame.draw.line(surf, STEEL, hand, tip, max(2, int(2.6 * kk)))
        pygame.draw.line(surf, (130, 130, 140), hand, tip, 1)
        gx, gy = P(6 * hx, -10 + s * 2)
        pygame.draw.line(surf, GOLD if elite else IRON_D, (gx - int(3 * kk), gy - int(2 * kk)),
                         (gx + int(3 * kk), gy + int(2 * kk)), lw)
    return art


def samurai(elite):
    """Самурай: шлем кабуто с золотым полумесяцем, ламеллярный доспех, изогнутый меч; у элиты — флажок на спине."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving, legs=(40, 36, 40))
        if elite:
            # сасимоно — узкий флажок на шесте
            pygame.draw.line(surf, WOOD_D, P(-3 * hx, -8), P(-3 * hx, -30), max(1, int(1.3 * kk)))
            _poly(surf, color, [P(-3 * hx, -30), P(-8 * hx, -30), P(-8 * hx, -21), P(-3 * hx, -21)], shade(color, -80))
            pygame.draw.circle(surf, WHITE, P(-5.5 * hx, -25.5), max(1, int(1.4 * kk)))
        # ламели: тёмные полосы на торсе
        for yy in (-10.5, -8, -5.5):
            pygame.draw.line(surf, shade(color, -70), P(-4.5, yy), P(4.5, yy), 1)
        # наплечники-содэ
        for sx in (-5, 5):
            pygame.draw.rect(surf, shade(color, -40), (*P(sx - 1.6, -12), int(3.2 * kk), int(4.5 * kk)))
        # кабуто: чёрный купол, широкий назатыльник, полумесяц
        pygame.draw.ellipse(surf, (40, 38, 44), (*P(-4, -20.5), int(8 * kk), int(5.5 * kk)))
        pygame.draw.polygon(surf, (40, 38, 44), [P(-5.5, -16), P(5.5, -16), P(4, -17.5), P(-4, -17.5)])
        pygame.draw.arc(surf, GOLD, (*P(-3.6, -25), int(7.2 * kk), int(6 * kk)), math.pi * 1.05, math.pi * 1.95,
                        max(1, int(1.5 * kk)))
        # катана двумя руками: тонкий слегка изогнутый клинок
        s = swing / 0.3 if swing > 0 else 0
        hand = P(4 * hx, -9)
        ang = math.radians(-70 + 110 * s)
        L = 15 * kk
        pts = []
        for i in range(6):
            t = i / 5
            a = ang + 0.25 * t
            pts.append((hand[0] + math.cos(a) * L * t * hx, hand[1] + math.sin(a) * L * t))
        pygame.draw.lines(surf, STEEL, False, pts, max(1, int(1.8 * kk)))
        pygame.draw.line(surf, (40, 30, 30), hand, (hand[0] - int(2.5 * kk * hx * math.cos(ang)),
                                                  hand[1] - int(2.5 * kk * math.sin(ang))), max(2, int(2 * kk)))
        pygame.draw.circle(surf, GOLD, hand, max(1, int(1.2 * kk)))
    return art


def chukonu(elite):
    """Чо-ко-ну: широкая коническая шляпа, многозарядный арбалет с магазином."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving)
        lw = max(1, int(2 * kk))
        if elite:
            for yy in (-10.5, -7.5):
                pygame.draw.line(surf, shade(color, -60), P(-4.5, yy), P(4.5, yy), 1)
            pygame.draw.line(surf, GOLD, P(-4.5, -5), P(4.5, -5), max(1, int(1.5 * kk)))
        # шляпа
        hat = (200, 170, 100) if not elite else (70, 60, 50)
        _poly(surf, hat, [P(-7, -17), P(0, -22.5), P(7, -17)], shade(hat, -60))
        if elite:
            pygame.draw.line(surf, (215, 40, 40), P(0, -22.5), P(0, -25), max(1, int(2 * kk)))
            pygame.draw.circle(surf, (215, 40, 40), P(0, -25), max(1, int(1.5 * kk)))
        # арбалет: ложе, дуга, магазин сверху; при выстреле — рычаг вперёд
        s = swing / 0.3 if swing > 0 else 0
        a, b = P(0, -9), P(12 * hx, -10)
        pygame.draw.line(surf, (110, 78, 45), a, b, max(2, int(2.5 * kk)))
        bx, by = P(10 * hx, -10)
        pygame.draw.line(surf, (70, 60, 55), (bx, by - int(5 * kk)), (bx, by + int(5 * kk)), lw)
        pygame.draw.line(surf, (230, 230, 230), (bx, by - int(5 * kk)), P(6 * hx, -10), 1)
        pygame.draw.line(surf, (230, 230, 230), (bx, by + int(5 * kk)), P(6 * hx, -10), 1)
        mag = pygame.Rect(0, 0, int(7 * kk), int(3.5 * kk))
        mag.midbottom = P(6 * hx, -11)
        pygame.draw.rect(surf, (140, 100, 60), mag)
        pygame.draw.rect(surf, WOOD_D, mag, 1)
        lx, ly = P((1 + 3 * s) * hx, -12.5 - 2 * (1 - s))
        pygame.draw.line(surf, WOOD_D, P(3 * hx, -11), (lx, ly), max(1, int(1.5 * kk)))
    return art


def elephant(elite):
    """Боевой слон: огромный, с бивнями и хоботом; на спине — башенка-хауда с навесом в цвет игрока,
    погонщик на шее и лучник в башенке. У элиты — золочёные налобник и попона."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        hx = 1 if face[0] >= 0 else -1
        bob = math.sin(anim * 0.7) * 0.8 * k if moving else 0
        P = _P(x, y, k, bob)
        sc = 1.08 if elite else 1.0
        skin = (128, 124, 122)
        dark = shade(skin, -45)
        _shadow(surf, x - 22 * k * sc, y - 5 * k, 44 * k * sc, 13 * k)
        # ноги-колонны
        for i, lx in enumerate((-11, -6, 6, 11)):
            off = math.sin(anim * 0.7 + i * 1.6) * 1.8 if moving else 0
            c = dark if i in (0, 2) else skin
            pygame.draw.line(surf, c, P(lx * sc, -10), P(lx * sc + off, 1, False), max(3, int(5 * k)))
        # туловище
        body = (*P(-17 * sc, -26), int(34 * k * sc), int(20 * k))
        pygame.draw.ellipse(surf, skin, body)
        # попона
        cloth = color
        pygame.draw.ellipse(surf, cloth, (*P(-12 * sc, -24), int(24 * k * sc), int(14 * k)))
        trim = GOLD if elite else shade(color, 60)
        pygame.draw.ellipse(surf, trim, (*P(-12 * sc, -24), int(24 * k * sc), int(14 * k)), max(1, int(1.5 * k)))
        pygame.draw.ellipse(surf, shade(skin, -70), body, 1)
        # хвост
        pygame.draw.line(surf, dark, P(-17 * hx * sc, -20), P(-19 * hx * sc, -12), max(1, int(1.5 * k)))
        # голова, ухо, хобот, бивни
        hx0 = 16 * sc
        pygame.draw.circle(surf, skin, P(hx0 * hx, -22), int(7 * k))
        pygame.draw.ellipse(surf, shade(skin, -18), (*P((hx0 - 6) * hx - 4.5, -27), int(9 * k), int(11 * k)))
        pygame.draw.ellipse(surf, dark, (*P((hx0 - 6) * hx - 4.5, -27), int(9 * k), int(11 * k)), 1)
        s = swing / 0.3 if swing > 0 else 0
        trunk = [P((hx0 + 5) * hx, -21), P((hx0 + 8) * hx, -15), P((hx0 + 8 + 3 * s) * hx, -9 - 6 * s),
                 P((hx0 + 10 + 4 * s) * hx, -6 - 9 * s)]
        pygame.draw.lines(surf, skin, False, trunk, max(3, int(3.6 * k)))
        pygame.draw.lines(surf, dark, False, trunk, 1)
        pygame.draw.line(surf, (245, 240, 225), P((hx0 + 4) * hx, -17), P((hx0 + 10) * hx, -13),
                         max(2, int(2.4 * k)))
        pygame.draw.circle(surf, (30, 26, 24), P((hx0 + 3) * hx, -24), max(1, int(1.1 * k)))
        if elite:
            _poly(surf, GOLD, [P((hx0 - 2) * hx, -28), P((hx0 + 5) * hx, -26), P((hx0 + 4) * hx, -20),
                               P((hx0 - 1) * hx, -22)], shade(GOLD, -70))
        # погонщик на шее
        mx, my = (hx0 - 6) * hx, -31
        pygame.draw.circle(surf, (230, 225, 210), P(mx, my), int(2.8 * k))
        pygame.draw.circle(surf, SKIN, P(mx, my - 4.5), int(2.2 * k))
        pygame.draw.ellipse(surf, WHITE, (*P(mx - 2.4, my - 7.4), int(4.8 * k), int(2.6 * k)))
        # хауда: деревянный короб, лучник, навес
        _poly(surf, WOOD, [P(-8, -35), P(7, -35), P(6, -26), P(-7, -26)], WOOD_D)
        for i in range(-6, 7, 3):
            pygame.draw.line(surf, WOOD_D, P(i, -35), P(i * 0.93, -26), 1)
        pygame.draw.circle(surf, color, P(0, -38), int(3.4 * k))
        pygame.draw.circle(surf, SKIN, P(0, -42.5), int(2.4 * k))
        bxx, byy = P(4 * hx, -39)
        r = pygame.Rect(0, 0, int(5 * k), int(10 * k))
        r.center = (bxx, byy)
        a0 = -math.pi / 2 if hx > 0 else math.pi / 2
        pygame.draw.arc(surf, (130, 85, 40), r, a0, a0 + math.pi, max(1, int(1.5 * k)))
        for px in (-7, 6):
            pygame.draw.line(surf, WOOD_D, P(px, -35), P(px, -46), max(1, int(1.3 * k)))
        _poly(surf, shade(color, 25), [P(-9, -46), P(8, -46), P(0, -51)], shade(color, -70))
        pygame.draw.line(surf, trim, P(-9, -46), P(8, -46), max(1, int(1.3 * k)))
    return art


def mameluke(elite):
    """Мамлюк: тёмный верблюд, всадник в тюрбане со шлемом-шишаком, кривая сабля и круглый щит."""
    from .content import _army_art as aa
    base = aa.rider(horse=(150, 112, 70) if not elite else (120, 88, 58), bard='cloth' if elite else None,
                    head='turban', weapon='none', camel=True)

    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
        hx = 1 if face[0] >= 0 else -1
        P, by, ry, hy = _rider_pts(x, y, k, anim, moving, camel=True)
        # шишак над тюрбаном
        _poly(surf, GOLD if elite else IRON, [P(-1.6, hy - 3.2), P(0, hy - 7.5), P(1.6, hy - 3.2)])
        # щит на левой руке
        sx, sy = P(-4 * hx, ry + 1)
        pygame.draw.circle(surf, shade(color, -30), (sx, sy), max(2, int(3.2 * k)))
        pygame.draw.circle(surf, GOLD if elite else (200, 180, 120), (sx, sy), max(2, int(3.2 * k)), 1)
        # сабля: дуга
        s = swing * 20
        hand = P(3 * hx, ry)
        a0 = math.radians(-60 + s * 4)
        pts = [(hand[0] + math.cos(a0 + 0.35 * t / 5) * 11 * k * t / 5 * hx,
                hand[1] + math.sin(a0 + 0.35 * t / 5) * 11 * k * t / 5) for t in range(6)]
        pygame.draw.lines(surf, STEEL, False, pts, max(1, int(2 * k)))
        pygame.draw.circle(surf, GOLD, hand, max(1, int(1.2 * k)))
    return art


def janissary(elite):
    """Янычар: высокий белый колпак, длинный кафтан в цвет игрока, длинное ружьё с дымом при выстреле."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving)
        # полы кафтана
        _poly(surf, shade(color, -15), [P(-4.5, -6), P(4.5, -6), P(5.5, -1), P(-5.5, -1)], shade(color, -80))
        pygame.draw.line(surf, GOLD if elite else (220, 200, 150), P(-4.8, -6), P(4.8, -6), max(1, int(1.5 * kk)))
        # колпак-бёрк: высокий, загнут назад
        _poly(surf, WHITE, [P(-3.4, -17.5), P(3.4, -17.5), P(2 - 4 * hx, -26), P(-1 - 5 * hx, -25)],
              (170, 165, 150))
        pygame.draw.rect(surf, GOLD if elite else (200, 180, 120), (*P(-3.6, -18.5), int(7.2 * kk), int(2 * kk)))
        if elite:
            pygame.draw.line(surf, (245, 245, 240), P(0, -19), P(1.5 * hx, -28), max(2, int(2.2 * kk)))
        # ружьё
        s = swing / 0.3 if swing > 0 else 0
        a, b = P(-2 * hx, -9), P(15 * hx, -12)
        pygame.draw.line(surf, (110, 78, 45), a, P(5 * hx, -10.2), max(2, int(2.5 * kk)))
        pygame.draw.line(surf, (70, 70, 76), P(4 * hx, -10.4), b, max(2, int(2 * kk)))
        if s > 0.3:
            bx, by = b
            for i in range(3):
                pygame.draw.circle(surf, (225, 225, 225), (bx + int((3 + i * 3) * kk * hx), by - int(i * 2 * kk)),
                                   max(1, int((2.5 + i) * kk)))
            pygame.draw.circle(surf, (255, 200, 80), (bx + int(2 * kk * hx), by), max(1, int(1.5 * kk)))
    return art


def berserk(elite):
    """Берсерк: без шлема (у элиты — шлем с очками), рыжие волосы и борода, мех на плечах,
    широкий топор и круглый щит."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving, legs=(80, 66, 50))
        _round_shield(surf, P, hx, kk, shade(color, -10), pattern='spiral')
        # мех на плечах
        pygame.draw.ellipse(surf, FUR, (*P(-5.5, -13.5), int(11 * kk), int(4 * kk)))
        hair = (205, 110, 45)
        pygame.draw.polygon(surf, hair, [P(-1 + 1 * hx, -13), P(2.5 * hx, -13), P(1 * hx, -9.5)])
        if elite:
            pygame.draw.ellipse(surf, IRON, (*P(-3.8, -19.8), int(7.6 * kk), int(5 * kk)))
            pygame.draw.circle(surf, IRON_D, P(1.6 * hx, -15.5), max(1, int(1.2 * kk)), 1)
        else:
            for i in range(-3, 4):
                pygame.draw.line(surf, hair, P(i * 1.1, -17.5), P(i * 1.6, -20.5 + abs(i) * 0.4), max(1, int(kk)))
        # топор: замах сверху
        s = swing / 0.3 if swing > 0 else 0
        hand = P(4 * hx, -9)
        ang = math.radians(-100 + 120 * s)
        L = 12 * kk
        top = (hand[0] + math.cos(ang) * L * hx, hand[1] + math.sin(ang) * L)
        pygame.draw.line(surf, WOOD, hand, top, max(1, int(2 * kk)))
        tx, ty = top
        ca, sa = math.cos(ang), math.sin(ang)
        w = (5.5 if elite else 4.5) * kk
        blade = [(tx, ty), (tx - sa * w * hx * 0.2 + ca * 2 * kk * hx, ty + ca * w * 0.2 + sa * 2 * kk),
                 (tx + (-sa * w + ca * 3 * kk) * hx, ty + ca * w + sa * 3 * kk),
                 (tx + (-sa * w - ca * 2.5 * kk) * hx, ty + ca * w - sa * 2.5 * kk)]
        pygame.draw.polygon(surf, STEEL, blade)
        pygame.draw.polygon(surf, IRON_D, blade, 1)
    return art


def huskarl(elite):
    """Хускарл: большой круглый щит спереди (стрелы не берут), шлем с наносником, кольчуга, меч."""
    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving, torso=(150, 150, 158) if elite else None)
        # шлем
        _poly(surf, IRON, [P(-3.8, -16.5), P(0, -21.5), P(3.8, -16.5)], IRON_D)
        pygame.draw.line(surf, IRON_D, P(1.4 * hx, -17), P(1.4 * hx, -13.5), max(1, int(1.2 * kk)))
        # меч за щитом
        s = swing / 0.3 if swing > 0 else 0
        pygame.draw.line(surf, STEEL, P(4 * hx, -9), P((10 + s * 3) * hx, -18 + s * 11), max(1, int(2 * kk)))
        # щит спереди: большой, в цвет игрока, с узором
        sx, sy = P(4.5 * hx, -8)
        r = int((5.8 if elite else 5.2) * kk)
        pygame.draw.circle(surf, color, (sx, sy), r)
        pygame.draw.circle(surf, shade(color, 55), (sx, sy), r, max(1, int(1.2 * kk)))
        for a in range(0, 360, 90):
            ra = math.radians(a + 45)
            pygame.draw.line(surf, shade(color, -60), (sx, sy), (sx + int(math.cos(ra) * r), sy + int(math.sin(ra) * r)),
                             max(1, int(kk)))
        pygame.draw.circle(surf, GOLD if elite else STEEL, (sx, sy), max(1, int(1.6 * kk)))
    return art


def woad(elite):
    """Вайдовый воин: синяя раскраска, известковые торчащие волосы, клетчатый килт в цвет игрока, меч."""
    blue = (120, 150, 200)

    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        P, hx, kk = _foot(surf, color, x, y, face, anim, k, moving, skin=blue, torso=blue, legs=(90, 110, 160))
        # узоры на груди
        pygame.draw.arc(surf, (40, 60, 130), (*P(-3, -11), int(6 * kk), int(6 * kk)), 0.5, 5.5, 1)
        # килт
        _poly(surf, color, [P(-5, -6), P(5, -6), P(6, -1), P(-6, -1)], shade(color, -80))
        for i in (-3, 0, 3):
            pygame.draw.line(surf, shade(color, 60), P(i, -6), P(i * 1.2, -1), 1)
        pygame.draw.line(surf, shade(color, -60), P(-5.5, -3.5), P(5.5, -3.5), 1)
        # волосы
        for i in range(-3, 4):
            pygame.draw.line(surf, (235, 225, 190), P(i * 0.9, -17.5), P(i * 1.9, -22 + abs(i) * 0.5),
                             max(1, int(1.3 * kk)))
        if elite:
            pygame.draw.arc(surf, GOLD, (*P(-3.5, -14), int(7 * kk), int(4 * kk)), math.pi, 2 * math.pi,
                            max(1, int(1.5 * kk)))
        s = swing / 0.3 if swing > 0 else 0
        L = 1.2 if elite else 1.0
        pygame.draw.line(surf, STEEL, P(5 * hx, -8), P((5 + (10 + s * 3) * L) * hx, -8 - (11 - s * 13) * L),
                         max(2, int(2.2 * kk)))
        pygame.draw.line(surf, GOLD if elite else WOOD, P(3.5 * hx, -9.5), P(6.5 * hx, -6.5), max(1, int(2 * kk)))
    return art


def conquistador(elite):
    """Конкистадор: вороной конь, шлем-морион с гребнем и загнутыми полями, ружьё."""
    from .content import _army_art as aa
    base = aa.rider(horse=(46, 40, 38), bard='plate' if elite else None, head='skin', weapon='none')

    def art(surf, kind, color, x, y, face=(1.0, 0.0), anim=0.0, swing=0.0, k=1.0, carry_res=None, moving=False):
        base(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving)
        hx = 1 if face[0] >= 0 else -1
        P, by, ry, hy = _rider_pts(x, y, k, anim, moving)
        # кираса
        pygame.draw.circle(surf, IRON, P(0, ry), int(3.2 * k))
        # морион
        pygame.draw.arc(surf, STEEL, (*P(-5, hy - 3), int(10 * k), int(5 * k)), 0, math.pi, max(1, int(1.6 * k)))
        pygame.draw.ellipse(surf, STEEL, (*P(-2.8, hy - 5.5), int(5.6 * k), int(4 * k)))
        pygame.draw.line(surf, IRON_D, P(-1.8, hy - 6.5), P(1.8, hy - 6.5), max(1, int(1.4 * k)))
        if elite:
            pygame.draw.line(surf, shade(color, 60), P(0, hy - 6), P(-4 * hx, hy - 10), max(2, int(2 * k)))
        # ружьё наперевес
        s = swing / 0.3 if swing > 0 else 0
        b = P(15 * hx, ry - 4)
        pygame.draw.line(surf, (110, 78, 45), P(-1 * hx, ry + 1), P(5 * hx, ry - 1), max(2, int(2.4 * k)))
        pygame.draw.line(surf, (70, 70, 76), P(4 * hx, ry - 1), b, max(2, int(2 * k)))
        if s > 0.3:
            bx, by2 = b
            for i in range(3):
                pygame.draw.circle(surf, (225, 225, 225), (bx + int((3 + i * 3) * k * hx), by2 - int(i * 2 * k)),
                                   max(1, int((2.5 + i) * k)))
    return art


# ============================================================ гербы
def _shield_poly(r):
    """Контур щита (рыцарский «треугольный» щит с выпуклыми нижними краями) внутри прямоугольника r."""
    x, y, w, h = r
    top = h * 0.5
    pts = [(x, y), (x + w, y)]
    for i in range(13):
        a = i / 12 * math.pi / 2
        pts.append((x + w / 2 + w / 2 * math.cos(a) ** 0.8, y + top + (h - top) * math.sin(a)))
    for i in range(11, -1, -1):
        a = i / 12 * math.pi / 2
        pts.append((x + w / 2 - w / 2 * math.cos(a) ** 0.8, y + top + (h - top) * math.sin(a)))
    return pts


def _field(surf, r, div, c1, c2):
    x, y, w, h = r
    surf.fill(c1)
    if div == 'pale':
        pygame.draw.rect(surf, c2, (x + w // 2, y, w - w // 2, h))
    elif div == 'fess':
        pygame.draw.rect(surf, c2, (x, y + h // 2, w, h - h // 2))
    elif div == 'quarterly':
        pygame.draw.rect(surf, c2, (x + w // 2, y, w - w // 2, h // 2))
        pygame.draw.rect(surf, c2, (x, y + h // 2, w // 2, h - h // 2))
    elif div == 'bend':
        pygame.draw.polygon(surf, c2, [(x + w, y), (x + w, y + h), (x, y + h)])
    elif div == 'chevron':
        pygame.draw.polygon(surf, c2, [(x, y + h), (x + w / 2, y + h * 0.35), (x + w, y + h), (x + w, y + h * 0.75),
                                       (x + w / 2, y + h * 0.1), (x, y + h * 0.75)])
    elif div == 'bordure':
        pygame.draw.rect(surf, c2, (x, y, w, h))
        pygame.draw.rect(surf, c1, (x + w * 0.12, y + h * 0.1, w * 0.76, h * 0.8))
    elif div == 'chief':
        pygame.draw.rect(surf, c2, (x, y, w, h * 0.3))


def _lily(surf, cx, cy, s, c):
    o = shade(c, -90)
    pts = [(cx, cy - s), (cx + s * 0.28, cy - s * 0.35), (cx + s * 0.12, cy + s * 0.2), (cx - s * 0.12, cy + s * 0.2),
           (cx - s * 0.28, cy - s * 0.35)]
    _poly(surf, c, pts, o)
    for sg in (-1, 1):
        pts = [(cx + sg * s * 0.12, cy + s * 0.05), (cx + sg * s * 0.7, cy - s * 0.55), (cx + sg * s * 0.8, cy - s * 0.05),
               (cx + sg * s * 0.45, cy + s * 0.3)]
        _poly(surf, c, pts, o)
    pygame.draw.rect(surf, c, (cx - s * 0.5, cy + s * 0.2, s, s * 0.22))
    pygame.draw.rect(surf, o, (cx - s * 0.5, cy + s * 0.2, s, s * 0.22), 1)
    _poly(surf, c, [(cx - s * 0.15, cy + s * 0.42), (cx + s * 0.15, cy + s * 0.42), (cx, cy + s * 0.85)], o)


def _crown(surf, cx, cy, s, c):
    o = shade(c, -90)
    pts = [(cx - s, cy + s * 0.5), (cx - s, cy - s * 0.3), (cx - s * 0.5, cy + s * 0.05), (cx, cy - s * 0.6),
           (cx + s * 0.5, cy + s * 0.05), (cx + s, cy - s * 0.3), (cx + s, cy + s * 0.5)]
    _poly(surf, c, pts, o)
    for px, py in ((cx - s, cy - s * 0.3), (cx, cy - s * 0.6), (cx + s, cy - s * 0.3)):
        pygame.draw.circle(surf, c, (int(px), int(py)), max(2, int(s * 0.16)))
    pygame.draw.rect(surf, shade(c, -30), (cx - s, cy + s * 0.3, 2 * s, s * 0.22))
    for i in (-1, 0, 1):
        pygame.draw.circle(surf, (200, 40, 40) if i == 0 else (40, 120, 200), (int(cx + i * s * 0.55),
                                                                            int(cy + s * 0.41)), max(1, int(s * 0.1)))


def _cross(surf, cx, cy, s, c, pattee=True):
    o = shade(c, -60) if sum(c) > 300 else shade(c, 90)
    if pattee:
        for a in range(4):
            ang = a * math.pi / 2
            ca, sa = math.cos(ang), math.sin(ang)

            def R(u, v):
                return cx + u * ca - v * sa, cy + u * sa + v * ca
            _poly(surf, c, [R(0, -s * 0.18), R(s, -s * 0.5), R(s, s * 0.5), R(0, s * 0.18)], o)
        pygame.draw.circle(surf, c, (int(cx), int(cy)), max(2, int(s * 0.2)))
    else:
        pygame.draw.rect(surf, c, (cx - s * 0.2, cy - s, s * 0.4, 2 * s))
        pygame.draw.rect(surf, c, (cx - s, cy - s * 0.2, 2 * s, s * 0.4))


def _bird(surf, cx, cy, s, c, double=False):
    """Геральдическая птица с раскрытыми крыльями (двуглавая — double)."""
    o = shade(c, -100)
    for sg in (-1, 1):
        wing = [(cx + sg * s * 0.15, cy - s * 0.15), (cx + sg * s * 1.0, cy - s * 0.75), (cx + sg * s * 0.95, cy - s * 0.35),
                (cx + sg * s * 1.05, cy - s * 0.25), (cx + sg * s * 0.9, cy), (cx + sg * s * 0.95, cy + s * 0.1),
                (cx + sg * s * 0.25, cy + s * 0.2)]
        _poly(surf, c, wing, o)
    _poly(surf, c, [(cx - s * 0.25, cy - s * 0.3), (cx + s * 0.25, cy - s * 0.3), (cx + s * 0.2, cy + s * 0.45),
                    (cx, cy + s * 0.55), (cx - s * 0.2, cy + s * 0.45)], o)
    _poly(surf, c, [(cx - s * 0.35, cy + s * 0.5), (cx, cy + s * 0.35), (cx + s * 0.35, cy + s * 0.5),
                    (cx + s * 0.2, cy + s * 0.85), (cx, cy + s * 0.7), (cx - s * 0.2, cy + s * 0.85)], o)
    heads = ((-0.28, -1), (0.28, 1)) if double else ((0, 1),)
    for dx, sg in heads:
        hx, hy = cx + dx * s, cy - s * 0.52
        pygame.draw.circle(surf, c, (int(hx), int(hy)), max(2, int(s * 0.18)))
        pygame.draw.circle(surf, o, (int(hx), int(hy)), max(2, int(s * 0.18)), 1)
        _poly(surf, (225, 60, 40), [(hx + sg * s * 0.14, hy - s * 0.04), (hx + sg * s * 0.34, hy + s * 0.04),
                                    (hx + sg * s * 0.14, hy + s * 0.1)])


def _crescent(surf, cx, cy, s, c, bg, star=False):
    pygame.draw.circle(surf, c, (int(cx), int(cy)), int(s * 0.75))
    pygame.draw.circle(surf, bg, (int(cx + s * 0.28), int(cy - s * 0.05)), int(s * 0.62))
    if star:
        _star(surf, cx + s * 0.45, cy, s * 0.3, c)


def _star(surf, cx, cy, s, c, n=5):
    pts = []
    for i in range(n * 2):
        a = -math.pi / 2 + i * math.pi / n
        r = s if i % 2 == 0 else s * 0.42
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    pygame.draw.polygon(surf, c, pts)


def _sun(surf, cx, cy, s, c):
    for i in range(12):
        a = i * math.pi / 6
        a2 = a + math.pi / 12
        _poly(surf, c, [(cx + math.cos(a - 0.14) * s * 0.5, cy + math.sin(a - 0.14) * s * 0.5),
                        (cx + math.cos(a) * s, cy + math.sin(a) * s),
                        (cx + math.cos(a + 0.14) * s * 0.5, cy + math.sin(a + 0.14) * s * 0.5)])
        pygame.draw.line(surf, c, (cx + math.cos(a2) * s * 0.5, cy + math.sin(a2) * s * 0.5),
                         (cx + math.cos(a2) * s * 0.8, cy + math.sin(a2) * s * 0.8), max(1, int(s * 0.08)))
    pygame.draw.circle(surf, c, (int(cx), int(cy)), int(s * 0.48))
    pygame.draw.circle(surf, shade(c, -70), (int(cx), int(cy)), int(s * 0.48), 1)


def _bow(surf, cx, cy, s, c):
    r = pygame.Rect(0, 0, int(s * 1.0), int(s * 2.0))
    r.center = (int(cx - s * 0.1), int(cy))
    pygame.draw.arc(surf, c, r, -math.pi / 2, math.pi / 2, max(2, int(s * 0.16)))
    pygame.draw.line(surf, c, (r.centerx, r.top + 1), (r.centerx, r.bottom - 1), max(1, int(s * 0.06)))
    pygame.draw.line(surf, c, (cx - s * 0.9, cy), (cx + s * 0.75, cy), max(1, int(s * 0.1)))
    _poly(surf, c, [(cx + s * 0.95, cy), (cx + s * 0.65, cy - s * 0.18), (cx + s * 0.65, cy + s * 0.18)])
    for d in (-1, 1):
        pygame.draw.line(surf, c, (cx - s * 0.9, cy), (cx - s * 1.1, cy + d * s * 0.2), max(1, int(s * 0.08)))


def _axes(surf, cx, cy, s, c):
    for sg in (-1, 1):
        a = (cx - sg * s * 0.8, cy + s * 0.9)
        b = (cx + sg * s * 0.7, cy - s * 0.8)
        pygame.draw.line(surf, c, a, b, max(2, int(s * 0.14)))
        bx, by = b
        _poly(surf, c, [(bx - sg * s * 0.15, by + s * 0.1), (bx + sg * s * 0.1, by - s * 0.45),
                        (bx + sg * s * 0.5, by - s * 0.05), (bx + sg * s * 0.3, by + s * 0.35)], shade(c, -90))


def _swords(surf, cx, cy, s, c):
    for sg in (-1, 1):
        pts = []
        for i in range(7):
            t = i / 6
            px = cx - sg * s * 0.8 + sg * s * 1.6 * t
            py = cy + s * 0.85 - s * 1.7 * t - math.sin(t * math.pi) * s * 0.25 * sg * 0
            pts.append((px + math.sin(t * math.pi) * s * 0.15, py))
        pygame.draw.lines(surf, c, False, pts, max(3, int(s * 0.2)))
        gx, gy = pts[1]
        pygame.draw.line(surf, c, (gx - s * 0.2, gy - sg * s * 0.2), (gx + s * 0.2, gy + sg * s * 0.2),
                         max(1, int(s * 0.1)))


def _mon(surf, cx, cy, s, c, bg):
    """Круглый гербовый знак: круг и пять лепестков."""
    pygame.draw.circle(surf, c, (int(cx), int(cy)), int(s))
    pygame.draw.circle(surf, bg, (int(cx), int(cy)), int(s * 0.82))
    for i in range(5):
        a = -math.pi / 2 + i * 2 * math.pi / 5
        pygame.draw.circle(surf, c, (int(cx + math.cos(a) * s * 0.42), int(cy + math.sin(a) * s * 0.42)), int(s * 0.3))
    pygame.draw.circle(surf, bg, (int(cx), int(cy)), int(s * 0.18))


def _dragon(surf, cx, cy, s, c):
    """Свернувшийся змей-дракон: S-образное тело с гребнем и головой."""
    pts = []
    for i in range(24):
        t = i / 23
        a = t * math.pi * 2.2
        pts.append((cx + math.sin(a) * s * 0.55 * (1 - t * 0.2), cy + s * 0.8 - t * s * 1.5))
    pygame.draw.lines(surf, c, False, pts, max(3, int(s * 0.28)))
    for i in range(2, 22, 3):
        x, y = pts[i]
        pygame.draw.line(surf, shade(c, 40), (x, y), (x - s * 0.18, y - s * 0.1), max(1, int(s * 0.07)))
    hx, hy = pts[-1]
    pygame.draw.circle(surf, c, (int(hx), int(hy)), int(s * 0.22))
    _poly(surf, c, [(hx, hy - s * 0.1), (hx + s * 0.45, hy - s * 0.05), (hx, hy + s * 0.12)])
    pygame.draw.line(surf, c, (hx - s * 0.1, hy - s * 0.15), (hx - s * 0.3, hy - s * 0.4), max(1, int(s * 0.07)))


def _triskele(surf, cx, cy, s, c):
    for i in range(3):
        a0 = -math.pi / 2 + i * 2 * math.pi / 3
        pts = []
        for j in range(14):
            t = j / 13
            r = s * 0.85 * t
            a = a0 + t * 2.4
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
        pygame.draw.lines(surf, c, False, pts, max(2, int(s * 0.18)))
    pygame.draw.circle(surf, c, (int(cx), int(cy)), max(2, int(s * 0.14)))


def _tower(surf, cx, cy, s, c):
    o = shade(c, -90)
    pygame.draw.rect(surf, c, (cx - s * 0.55, cy - s * 0.35, s * 1.1, s * 1.15))
    pygame.draw.rect(surf, o, (cx - s * 0.55, cy - s * 0.35, s * 1.1, s * 1.15), 1)
    for i in range(3):
        pygame.draw.rect(surf, c, (cx - s * 0.65 + i * s * 0.5, cy - s * 0.65, s * 0.3, s * 0.35))
    pygame.draw.rect(surf, c, (cx - s * 0.7, cy - s * 0.4, s * 1.4, s * 0.12))
    pygame.draw.rect(surf, o, (cx - s * 0.16, cy + s * 0.35, s * 0.32, s * 0.45))
    pygame.draw.rect(surf, o, (cx - s * 0.35, cy - s * 0.1, s * 0.14, s * 0.22))
    pygame.draw.rect(surf, o, (cx + s * 0.21, cy - s * 0.1, s * 0.14, s * 0.22))


def _raven(surf, cx, cy, s, c):
    o = shade(c, 70)
    _poly(surf, c, [(cx - s * 0.9, cy + s * 0.1), (cx - s * 0.2, cy - s * 0.15), (cx + s * 0.3, cy - s * 0.55),
                    (cx + s * 0.55, cy - s * 0.5), (cx + s * 0.85, cy - s * 0.42), (cx + s * 0.55, cy - s * 0.3),
                    (cx + s * 0.4, cy + s * 0.15), (cx - s * 0.1, cy + s * 0.4), (cx - s * 0.5, cy + s * 0.75),
                    (cx - s * 0.45, cy + s * 0.35)], o)
    _poly(surf, c, [(cx - s * 0.2, cy - s * 0.1), (cx - s * 0.1, cy - s * 0.95), (cx + s * 0.25, cy - s * 0.2)], o)
    pygame.draw.circle(surf, o, (int(cx + s * 0.5), int(cy - s * 0.44)), max(1, int(s * 0.06)))


CHARGES = {'lily3': None, 'crown': _crown, 'cross': _cross, 'eagle': _bird, 'eagle2': None, 'crescent': None,
           'crescent_star': None, 'sun': _sun, 'bow': _bow, 'axes': _axes, 'swords': _swords, 'mon': None,
           'dragon': _dragon, 'triskele': _triskele, 'tower': _tower, 'raven': _raven, 'star': _star}


def draw_emblem(surf, rect, spec, outline=(30, 24, 18)):
    """Герб: spec = dict(field=(c1, c2), div='plain'|'pale'|'fess'|'quarterly'|'bend'|'chevron'|'bordure'|'chief',
    charge='lily3'|'crown'|'cross'|'eagle'|'eagle2'|'crescent'|'crescent_star'|'sun'|'bow'|'axes'|'swords'|'mon'|
    'dragon'|'triskele'|'tower'|'raven'|'star', metal=цвет фигуры)."""
    rect = pygame.Rect(rect)
    w, h = rect.size
    tmp = pygame.Surface((w, h), pygame.SRCALPHA)
    c1, c2 = spec['field']
    _field(tmp, (0, 0, w, h), spec.get('div', 'plain'), c1, c2)
    s = min(w, h) * 0.3
    cx, cy = w / 2, h * 0.44
    m = spec.get('metal', (240, 205, 80))
    ch = spec.get('charge')
    if ch == 'lily3':
        for (dx, dy, sc) in ((-0.24, -0.1, 0.55), (0.24, -0.1, 0.55), (0, 0.3, 0.55)):
            _lily(tmp, cx + dx * w, cy + dy * h, s * sc * 1.2, m)
    elif ch == 'eagle2':
        _bird(tmp, cx, cy + s * 0.1, s * 1.05, m, double=True)
    elif ch == 'eagle':
        _bird(tmp, cx, cy + s * 0.1, s * 1.05, m)
    elif ch in ('crescent', 'crescent_star'):
        _crescent(tmp, cx - s * 0.1, cy, s * 1.1, m, c1, star=ch == 'crescent_star')
    elif ch == 'mon':
        _mon(tmp, cx, cy + s * 0.05, s * 0.95, m, c1)
    elif ch == 'star':
        _star(tmp, cx, cy, s, m)
    elif ch in CHARGES and CHARGES[ch]:
        CHARGES[ch](tmp, cx, cy + s * 0.05, s, m)
    mask = pygame.Surface((w, h), pygame.SRCALPHA)
    poly = _shield_poly((1, 1, w - 2, h - 2))
    pygame.draw.polygon(mask, (255, 255, 255, 255), poly)
    tmp.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)
    # блик сверху слева
    hl = pygame.Surface((w, h), pygame.SRCALPHA)
    pygame.draw.polygon(hl, (255, 255, 255, 38), [(2, 2), (w * 0.5, 2), (2, h * 0.5)])
    hl.blit(mask, (0, 0), special_flags=pygame.BLEND_RGBA_MIN)
    tmp.blit(hl, (0, 0))
    surf.blit(tmp, rect.topleft)
    pts = [(rect.x + px, rect.y + py) for px, py in poly]
    pygame.draw.polygon(surf, outline, pts, max(1, int(w / 26)))
    pygame.draw.polygon(surf, shade(m, -20), [(rect.x + px, rect.y + py) for px, py in
                                              _shield_poly((w * 0.06, h * 0.05, w * 0.88, h * 0.9))], 1)


_EMB = {}


def emblem(spec_key, spec, w, h):
    """Кэшированная картинка герба."""
    key = (spec_key, w, h)
    img = _EMB.get(key)
    if img is None:
        img = pygame.Surface((w, h), pygame.SRCALPHA)
        draw_emblem(img, (0, 0, w, h), spec)
        _EMB[key] = img
    return img
