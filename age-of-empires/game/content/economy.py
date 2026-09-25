"""Полная экономика: рынок, торговая повозка, экономические технологии, пересев ферм.

Числа — как в классической исторической RTS (Definitive Edition). Логика — game/market.py,
кнопки и панели интерфейса — game/economy_ui.py, ИИ — game/eco_ai.py.
"""
import math

from . import add_unit, add_building, add_tech
from ..data import TECHS, AGE_REQ, BUILDINGS
from .. import market


# ============================================================ графика
def _market_art(p, surf, color, s):
    import pygame
    from ..gfx import PLASTER, WOOD, ROOF_RED, shade
    # мощёная площадь
    p.poly([(0.08, 0.08), (s - 0.08, 0.08), (s - 0.08, s - 0.08), (0.08, s - 0.08)], (176, 160, 128), outline=False)
    for i in range(1, 8):
        t = s * i / 8
        p.line((t, 0.1, 0), (t, s - 0.1, 0), (158, 142, 112))
        p.line((0.1, t, 0), (s - 0.1, t, 0), (158, 142, 112))
    # торговый дом в глубине
    p.box(0.35, 0.3, 2.9, 1.45, 30, PLASTER, top=False, tex='timber')
    p.door(1.6, 1.45, 0.4, 16)
    p.window_l(0.8, 1.45, 17)
    p.window_l(2.4, 1.45, 17)
    p.window_r(2.9, 0.85, 17)
    p.gable(0.35, 0.3, 2.9, 1.45, 30, 22, ROOF_RED, PLASTER, axis='x')
    p.banner_l(1.1, 1.45, 28, color)
    p.banner_l(2.1, 1.45, 28, color)

    def stall(x0, y0, x1, y1, stripes=5):
        # стойки, прилавок, навес в полоску (цвет игрока / белый)
        for (px, py) in ((x0, y0), (x1 - 0.06, y0), (x0, y1 - 0.06), (x1 - 0.06, y1 - 0.06)):
            p.box(px, py, px + 0.06, py + 0.06, 20, (110, 78, 48), top=False)
        p.box(x0 + 0.05, y1 - 0.35, x1 - 0.05, y1 - 0.05, 9, WOOD, tex='wood')
        for i in range(stripes):
            a = x0 - 0.08 + (x1 - x0 + 0.16) * i / stripes
            b = x0 - 0.08 + (x1 - x0 + 0.16) * (i + 1) / stripes
            c = color if i % 2 == 0 else (238, 232, 218)
            p.poly([(a, y0 - 0.05, 24), (b, y0 - 0.05, 24), (b, y1 + 0.12, 17), (a, y1 + 0.12, 17)], c, outline=False)
        p.line((x0 - 0.08, y1 + 0.12, 17), (x1 + 0.08, y1 + 0.12, 17), shade(color, -70), 1)
        p.line((x1 + 0.08, y0 - 0.05, 24), (x1 + 0.08, y1 + 0.12, 17), shade(color, -70), 1)

    stall(0.4, 2.0, 1.6, 2.9)
    # товары на прилавке: хлеб/фрукты
    for i, c in enumerate(((215, 60, 50), (240, 200, 40), (215, 60, 50))):
        x, y = p.P(0.65 + i * 0.35, 2.7, 10)
        pygame.draw.circle(surf, c, (int(x), int(y)), 3)
    stall(2.3, 1.95, 3.5, 2.85)
    x, y = p.P(2.7, 2.65, 10)
    pygame.draw.ellipse(surf, (165, 165, 175), (x - 4, y - 3, 9, 5))
    x, y = p.P(3.1, 2.65, 10)
    pygame.draw.ellipse(surf, (150, 100, 55), (x - 5, y - 2, 10, 4))
    # ящики и бочки на площади
    p.box(2.2, 3.15, 2.55, 3.5, 10, (150, 112, 70), tex='wood')
    p.box(2.6, 3.25, 2.9, 3.55, 8, (138, 102, 64), tex='wood')
    p.box(2.3, 3.2, 2.5, 3.4, 7, (160, 120, 76), z0=10, tex='wood')
    for (bx, by) in ((3.3, 3.3), (3.55, 3.05), (1.0, 3.45)):
        x, y = p.P(bx, by, 0)
        pygame.draw.rect(surf, (120, 80, 45), (x - 5, y - 13, 10, 13), border_radius=3)
        pygame.draw.line(surf, (70, 60, 50), (x - 5, y - 10), (x + 4, y - 10), 1)
        pygame.draw.line(surf, (70, 60, 50), (x - 5, y - 4), (x + 4, y - 4), 1)
        pygame.draw.ellipse(surf, (150, 105, 62), (x - 5, y - 15, 10, 4))
    # мешки с золотом
    for i in range(3):
        x, y = p.P(1.6 + i * 0.18, 3.5, 0)
        pygame.draw.circle(surf, (205, 180, 120), (int(x), int(y) - 4), 4)
        pygame.draw.circle(surf, (240, 200, 40), (int(x), int(y) - 7), 2)
    p.flag(0.5, 0.45, 52, color, 20)
    p.emblem(1.6, 1.45, 38, color, 'wheel')


def _trade_cart_art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving):
    import pygame
    from ..gfx import shadow, shade
    fx, fy = face
    hx = 1 if fx >= 0 else -1
    bob = math.sin(anim) * 0.8 * k if moving else 0

    def P(a, b, bb=True):
        return int(x + a * k), int(y + b * k + (bob if bb else 0))

    lw = max(1, int(2 * k))
    shadow(surf, x - 17 * k, y - 4 * k, 34 * k, 10 * k)
    horse = (132, 92, 56)
    # лошадь впереди
    for i, lx in enumerate((6, 9, 14, 17)):
        off = math.sin(anim + i * 1.7) * 2.5 if moving else 0
        pygame.draw.line(surf, shade(horse, -40), P(lx * hx, -3), P((lx + off) * hx, 2, False), lw)
    pygame.draw.ellipse(surf, horse, (*P(5 if hx > 0 else -19, -10), int(14 * k), int(8 * k)))
    pygame.draw.polygon(surf, horse, [P(16 * hx, -9), P(20 * hx, -15), P(23 * hx, -13), P(19 * hx, -6)])
    pygame.draw.circle(surf, horse, P(22 * hx, -14), max(2, int(2.8 * k)))
    pygame.draw.line(surf, (90, 65, 40), P(4 * hx, -6), P(10 * hx, -6), lw)
    # повозка
    body = (150, 110, 68)
    pygame.draw.rect(surf, body, (*P(-14, -12), int(19 * k), int(8 * k)))
    pygame.draw.rect(surf, shade(body, -50), (*P(-14, -12), int(19 * k), int(8 * k)), 1)
    # тент в цвет игрока
    pygame.draw.ellipse(surf, color, (*P(-14, -21), int(19 * k), int(14 * k)))
    pygame.draw.ellipse(surf, shade(color, -70), (*P(-14, -21), int(19 * k), int(14 * k)), 1)
    pygame.draw.rect(surf, body, (*P(-14, -12), int(19 * k), int(4 * k)))
    for tx in (-10, -5, 0):
        pygame.draw.line(surf, shade(color, 40), P(tx, -20), P(tx, -13), 1)
    if carry_res:
        for i in range(2):
            pygame.draw.circle(surf, (240, 200, 40), P(-11 + i * 5, -12), max(2, int(2.6 * k)))
    for wx in (-11, 2):
        pygame.draw.circle(surf, (70, 50, 32), P(wx, -2, False), max(2, int(4 * k)))
        pygame.draw.circle(surf, (130, 100, 64), P(wx, -2, False), max(1, int(1.5 * k)))


# ============================================================ здания и юниты
def _market_buttons(game, b, p):
    from ..economy_ui import market_buttons
    return market_buttons(game, b, p)


def _market_panel(game, b, x, y):
    from ..economy_ui import market_panel
    market_panel(game, b, x, y)


def _mill_buttons(game, b, p):
    from ..economy_ui import mill_buttons
    return mill_buttons(game, b, p)


def _mill_panel(game, b, x, y):
    from ..economy_ui import mill_panel
    mill_panel(game, b, x, y)


def _cart_panel(game, u, x, y):
    from ..economy_ui import cart_panel
    cart_panel(game, u, x, y)


add_building('market', name='Рынок', size=4, hp=1800, cost={'wood': 175}, time=60, age=1, los=6,
             trains=['trade_cart'], techs=[], desc='Торговля, дань, повозки', art=_market_art, art_h=90,
             buttons=_market_buttons, panel=_market_panel)
# рынок — одно из зданий для перехода в Эпоху замков
AGE_REQ['castle'][0].add('market')

add_unit('trade_cart', name='Торговая повозка', hp=70, atk=0, rng=0, reload=2.0, arm=(0, 0), speed=1.0, los=7,
         cost={'wood': 100, 'food': 50}, time=51, age=1, cls='vil', radius=12, civil=True,
         desc='Возит золото между рынками', art=_trade_cart_art, command=market.trade_command, panel=_cart_panel,
         states={'trade': market.do_trade})

# мельница: кнопки очереди пересева ферм
BUILDINGS['mill']['buttons'] = _mill_buttons
BUILDINGS['mill']['panel'] = _mill_panel

# ============================================================ технологии
V = 'villager'

# рынок
add_tech('coinage', at='market', name='Чеканка монет', cost={'food': 150, 'gold': 50}, time=50, age=1, icon='Мн',
         desc='Дань без сбора', effects=[{'stat': 'tribute_fee', 'mul': 0}])
add_tech('caravan', at='market', name='Караван', cost={'food': 200, 'gold': 200}, time=40, age=2, icon='Кв',
         desc='Повозки: +50% скорость', effects=[{'stat': 'speed', 'kind': 'trade_cart', 'mul': 1.5}])
add_tech('guilds', at='market', name='Гильдии', cost={'food': 300, 'gold': 200}, time=60, age=3, icon='Гл',
         desc='Сбор рынка 15%', effects=[{'stat': 'market_fee', 'mul': 0.5}])

# мельница
add_tech('heavy_plow', at='mill', name='Тяжёлый плуг', cost={'food': 125, 'wood': 125}, time=40, age=2, icon='Пл',
         req='horse_collar', desc='+125 еды фермам, +1 груз фермера',
         effects=[{'stat': 'farm_food', 'add': 125}, {'stat': 'carry', 'kind': V, 'src': 'farm', 'add': 1}])
add_tech('crop_rotation', at='mill', name='Севооборот', cost={'food': 250, 'wood': 250}, time=70, age=3, icon='Св',
         req='heavy_plow', desc='+175 еды фермам', effects=[{'stat': 'farm_food', 'add': 175}])

# лесопилка
add_tech('bow_saw', at='lumber_camp', name='Лучковая пила', cost={'food': 150, 'wood': 100}, time=50, age=2,
         icon='П+', req='double_bit', desc='+20% добыча дерева',
         effects=[{'stat': 'gather', 'res': 'wood', 'mul': 1.2}])
add_tech('two_man_saw', at='lumber_camp', name='Двуручная пила', cost={'food': 300, 'wood': 200}, time=100, age=3,
         icon='П2', req='bow_saw', desc='+10% добыча дерева',
         effects=[{'stat': 'gather', 'res': 'wood', 'mul': 1.1}])

# шахта
add_tech('gold_shaft', at='mining_camp', name='Шахтная добыча золота', cost={'food': 200, 'wood': 150}, time=75,
         age=2, icon='З2', req='gold_mining', desc='+15% добыча золота',
         effects=[{'stat': 'gather', 'res': 'gold', 'mul': 1.15}])
add_tech('stone_mining', at='mining_camp', name='Добыча камня', cost={'food': 100, 'wood': 75}, time=30, age=1,
         icon='К+', desc='+15% добыча камня', effects=[{'stat': 'gather', 'res': 'stone', 'mul': 1.15}])
add_tech('stone_shaft', at='mining_camp', name='Шахтная добыча камня', cost={'food': 200, 'wood': 150}, time=75,
         age=2, icon='К2', req='stone_mining', desc='+15% добыча камня',
         effects=[{'stat': 'gather', 'res': 'stone', 'mul': 1.15}])

# городской центр
add_tech('hand_cart', at='town_center', name='Ручная тележка', cost={'food': 300, 'wood': 200}, time=55, age=2,
         icon='Рт', req='wheelbarrow', desc='Жители: +10% скорость, +50% груз',
         effects=[{'stat': 'speed', 'kind': V, 'mul': 1.1}, {'stat': 'carry', 'kind': V, 'mul': 1.4}])
add_tech('town_watch', at='town_center', name='Городская стража', cost={'food': 75}, time=25, age=1, icon='Гс',
         desc='Здания: +4 обзор', effects=[{'stat': 'los', 'cls': 'bld', 'add': 4}])
add_tech('town_patrol', at='town_center', name='Городской патруль', cost={'food': 300, 'gold': 200}, time=40, age=2,
         icon='Гп', req='town_watch', desc='Здания: +4 обзор', effects=[{'stat': 'los', 'cls': 'bld', 'add': 4}])

# сверка уже существующих экономических технологий с таблицами оригинала
for _k, _cost, _time, _age in (('loom', {'gold': 50}, 25, 0), ('wheelbarrow', {'food': 175, 'wood': 50}, 75, 1),
                               ('horse_collar', {'food': 75, 'wood': 75}, 20, 1),
                               ('double_bit', {'food': 100, 'wood': 50}, 25, 1),
                               ('gold_mining', {'food': 100, 'wood': 75}, 30, 1)):
    TECHS[_k].update(cost=_cost, time=_time, age=_age)
