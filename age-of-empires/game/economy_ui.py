"""Интерфейс экономики: кнопки рынка (купить/продать/дань), очередь пересева на мельнице, панели.

Кнопки — обычные пункты для Game.layout_buttons: icon=('draw', fn(game, rect, ok)), act=('call', fn(game)).
"""
import pygame

from .data import RES_NAME, shade
from . import market as mk

UP = (120, 220, 110)
DOWN = (235, 110, 90)


def _arrow(scr, x, y, up, color, s=5):
    if up:
        pts = [(x, y - s), (x + s, y + s // 2), (x - s, y + s // 2)]
    else:
        pts = [(x, y + s), (x + s, y - s // 2), (x - s, y - s // 2)]
    pygame.draw.polygon(scr, color, pts)
    pygame.draw.polygon(scr, (25, 20, 15), pts, 1)


def _shift_n(game):
    return 5 if game.mods() & pygame.KMOD_SHIFT else 1


# ------------------------------------------------------------ рынок
def _trade_btn(r, buying):
    def draw(game, rect, ok):
        p = game.world.players[0]
        game.res_icon(r, rect.centerx - 7, rect.y + 16, 9)
        _arrow(game.screen, rect.right - 10, rect.y + 15, buying, UP if buying else DOWN, 6)
        price = mk.buy_price(p, r) if buying else mk.sell_price(p, r)
        game.res_icon('gold', rect.x + 9, rect.bottom - 11, 5)
        game.text(str(price), (rect.x + 16, rect.bottom - 11), 's', (255, 235, 150) if ok else (150, 140, 120),
                  anchor='midleft')

    def act(game):
        w = game.world
        p = w.players[0]
        fn = mk.buy if buying else mk.sell
        done = sum(1 for _ in range(_shift_n(game)) if fn(w, p, r))
        if not done:
            w.msg('Не хватает ресурсов', (255, 150, 90))
    return draw, act


def _tribute_btn(ally, r):
    def draw(game, rect, ok):
        q = game.world.players[ally]
        game.res_icon(r, rect.centerx - 8, rect.centery - 4, 9)
        cx, cy = rect.right - 12, rect.y + 13
        pygame.draw.circle(game.screen, q.color, (cx, cy), 7)
        pygame.draw.circle(game.screen, (240, 235, 220), (cx, cy), 7, 1)
        pygame.draw.polygon(game.screen, (240, 235, 220), [(rect.centerx + 2, rect.bottom - 16),
                                                           (rect.centerx + 10, rect.bottom - 12),
                                                           (rect.centerx + 2, rect.bottom - 8)])
        game.text(str(mk.LOT), (rect.x + 5, rect.bottom - 12), 's', (230, 225, 210) if ok else (150, 140, 120),
                  anchor='midleft')

    def act(game):
        w = game.world
        p = w.players[0]
        done = sum(1 for _ in range(_shift_n(game)) if mk.tribute(w, p, ally, r))
        if not done:
            w.msg('Не хватает ресурсов', (255, 150, 90))
    return draw, act


def market_buttons(game, b, p):
    w = game.world
    items = []
    for buying in (True, False):
        for r in mk.GOODS:
            draw, act = _trade_btn(r, buying)
            if buying:
                cost = {'gold': mk.buy_price(p, r)}
                ok = p.res['gold'] >= cost['gold']
                tip = [f'Купить: {RES_NAME[r].lower()}', cost, f'+{mk.LOT}', ('dim', 'Shift — ×5')]
            else:
                cost = {r: mk.LOT}
                ok = p.res[r] >= mk.LOT
                tip = [f'Продать: {RES_NAME[r].lower()}', cost, f'+{mk.sell_price(p, r)} золота',
                       ('dim', 'Shift — ×5')]
            items.append(dict(icon=('draw', draw), act=('call', act), ok=ok, tip=tip))
    for q in w.players:
        if q.id == p.id or not q.alive or not w.allied(p.id, q.id):
            continue
        for r in ('gold', 'food', 'wood', 'stone'):
            draw, act = _tribute_btn(q.id, r)
            cost = {r: mk.tribute_cost(p)}
            items.append(dict(icon=('draw', draw), act=('call', act), ok=p.res[r] >= cost[r],
                              tip=[f'Дань → {q.name}', cost, f'+{mk.LOT} {RES_NAME[r].lower()}',
                                   ('dim', f'Сбор {int(round(mk.tribute_fee(p) * 100))}%')]))
    return items


def market_panel(game, b, x, y):
    """Цены рынка: ресурс, покупка ▲, продажа ▼ и полоска уровня цены."""
    if b.owner != 0:
        return
    p = game.world.players[0]
    scr = game.screen
    for i, r in enumerate(mk.GOODS):
        cx = x + i * 150
        game.res_icon(r, cx + 8, y)
        _arrow(scr, cx + 26, y, True, UP, 4)
        game.text(str(mk.buy_price(p, r)), (cx + 33, y), 'b', anchor='midleft')
        _arrow(scr, cx + 76, y, False, DOWN, 4)
        game.text(str(mk.sell_price(p, r)), (cx + 83, y), 'b', anchor='midleft')
        lvl = min(1.0, mk.prices(p)[r] / 300)
        pygame.draw.rect(scr, (25, 20, 18), (cx, y + 12, 120, 4))
        pygame.draw.rect(scr, shade((240, 200, 40), -40 + int(60 * lvl)), (cx, y + 12, int(120 * lvl), 4))
    carts = [u for u in game.world.units if u.owner == 0 and u.kind == 'trade_cart']
    if carts:
        trading = sum(1 for u in carts if u.state == 'trade')
        ic = game.icon('u', 'trade_cart', 0, 26)
        scr.blit(ic, (x + 450, y - 14))
        game.text(f'{trading}/{len(carts)}', (x + 478, y), 'b', anchor='midleft')


# ------------------------------------------------------------ мельница: пересев
def _farm_icon(game, rect, sign):
    img = game.icon('b', 'farm', 0, 42)
    game.screen.blit(img, img.get_rect(center=(rect.centerx - 4, rect.centery + 2)))
    cx, cy = rect.right - 11, rect.y + 11
    pygame.draw.circle(game.screen, (60, 140, 60) if sign > 0 else (160, 60, 50), (cx, cy), 7)
    pygame.draw.line(game.screen, (250, 250, 240), (cx - 4, cy), (cx + 4, cy), 2)
    if sign > 0:
        pygame.draw.line(game.screen, (250, 250, 240), (cx, cy - 4), (cx, cy + 4), 2)


def _reseed_add(game):
    w = game.world
    if not mk.queue_reseed(w, w.players[0], _shift_n(game)):
        w.msg('Не хватает ресурсов', (255, 150, 90))


def _reseed_del(game):
    w = game.world
    mk.cancel_reseed(w, w.players[0], _shift_n(game))


def mill_buttons(game, b, p):
    n = mk.reseeds(p)
    cost = p.cost_of('bld', 'farm')

    def draw_add(g, rect, ok):
        _farm_icon(g, rect, 1)
        g.text(str(n), (rect.x + 5, rect.bottom - 12), 'b', (255, 235, 150), anchor='midleft')

    items = [dict(icon=('draw', draw_add), act=('call', _reseed_add), ok=p.afford(cost),
                  tip=['Пересев фермы', cost, 'Ферма восстановится сама', ('dim', f'В очереди: {n}. Shift — ×5')])]
    if n:
        items.append(dict(icon=('draw', lambda g, rect, ok: _farm_icon(g, rect, -1)), act=('call', _reseed_del),
                          ok=True, tip=['Отменить пересев', {}, 'Вернуть дерево']))
    return items


def mill_panel(game, b, x, y):
    if b.owner != 0:
        return
    n = mk.reseeds(game.world.players[0])
    img = game.icon('b', 'farm', 0, 28)
    game.screen.blit(img, (x, y - 14))
    game.text(f'×{n}', (x + 32, y), 'b', (255, 235, 150) if n else (170, 160, 140), anchor='midleft')


# ------------------------------------------------------------ торговая повозка
def cart_panel(game, u, x, y):
    if u.carry >= 1:
        game.res_icon('gold', x + 8, y + 30)
        game.text(str(int(u.carry)), (x + 20, y + 30), 'b', anchor='midleft')
    if u.state == 'trade':
        dest = getattr(u, 'trade_dest', None)
        if dest is not None:
            gold = mk.trade_gold(game.world, u.trade_home, dest) if getattr(u, 'trade_home', None) else 0
            col = game.world.players[dest.owner].color
            pygame.draw.circle(game.screen, col, (x + 90, y + 30), 6)
            game.text(f'→ {int(gold)}', (x + 102, y + 30), 'b', (255, 235, 150), anchor='midleft')
