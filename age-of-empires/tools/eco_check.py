#!/usr/bin/env python3
"""Безоконная проверка экономики через интерфейс: рынок (купить/продать, цены), дань союзнику,
очередь пересева ферм на мельнице (ферма восстанавливается сама), торговая повозка.
Скриншоты — в --out (market.png, mill.png, cart.png).

  .venv/bin/python tools/eco_check.py --out shots/eco
Выход с ненулевым кодом, если проверка не прошла.
"""
import argparse
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import pygame  # noqa: E402

from game.data import TILE  # noqa: E402
from game.ui import Game  # noqa: E402
from game import market as mk  # noqa: E402


def check(cond, what):
    print(('OK   ' if cond else 'FAIL ') + what)
    if not cond:
        check.failed = True


check.failed = False


def free_spot(w, kind, cx, cy, rmin=3):
    s = __import__('game.data', fromlist=['BUILDINGS']).BUILDINGS[kind]['size']
    for r in range(rmin, 30):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dx), abs(dy)) == r and w.can_place(kind, cx + dx, cy + dy, 0, check_explored=False):
                    ok = all(w.can_place(kind, cx + dx + ex, cy + dy + ey, 0, check_explored=False)
                             for ex in (-1, 1) for ey in (-1, 1))
                    if ok or s == 1:
                        return cx + dx, cy + dy
    raise RuntimeError('нет места')


def buttons_by_tip(g, word):
    return [b for b in g.get_buttons() if word in b['tip'][0]]


def snap(g, path, sel, center):
    g.selected = sel
    g.center_on(*center)
    g.draw()
    pygame.image.save(g.screen, path)
    print('сохранено', path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='shots/eco')
    ap.add_argument('--seed', type=int, default=2)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(a.seed)
    g = Game()
    g.new_game(1, 2, ally=True)          # 3 игрока: вы + союзник (1) против 2
    w = g.world
    w.ais = []                           # ИИ не мешает проверке
    p = w.players[0]
    p.age = 2
    p.res = {'food': 2000, 'wood': 2000, 'gold': 2000, 'stone': 2000}
    sx, sy = w.starts[0]

    # ---- рынок
    mx, my = free_spot(w, 'market', sx, sy, 5)
    m1 = w.place_building('market', 0, mx, my, complete=True)
    g.selected = [m1]
    buy = buttons_by_tip(g, 'Купить')
    sell = buttons_by_tip(g, 'Продать')
    check(len(buy) == 3 and len(sell) == 3, f'у рынка 3 кнопки покупки и 3 продажи ({len(buy)}/{len(sell)})')
    bf = next(b for b in buy if 'еда' in b['tip'][0])
    g0, f0 = p.res['gold'], p.res['food']
    check(mk.buy_price(p, 'food') == 130 and mk.sell_price(p, 'food') == 70, 'стартовые цены 130/70')
    g.press_button(bf)
    check(p.res['gold'] == g0 - 130 and p.res['food'] == f0 + 100, 'купили 100 еды за 130 золота')
    check(mk.prices(p)['food'] == 103, f'цена еды выросла до 103 ({mk.prices(p)["food"]})')
    check(mk.buy_price(p, 'food') == 134, f'следующая покупка 134 ({mk.buy_price(p, "food")})')
    for _ in range(4):
        g.press_button(next(b for b in buttons_by_tip(g, 'Купить') if 'еда' in b['tip'][0]))
    check(mk.prices(p)['food'] == 115, f'после 5 покупок цена 115 ({mk.prices(p)["food"]})')
    sw = next(b for b in buttons_by_tip(g, 'Продать') if 'дерево' in b['tip'][0])
    g0, w0 = p.res['gold'], p.res['wood']
    g.press_button(sw)
    check(p.res['gold'] == g0 + 70 and p.res['wood'] == w0 - 100, 'продали 100 дерева за 70 золота')
    check(mk.prices(p)['wood'] == 97, f'цена дерева упала до 97 ({mk.prices(p)["wood"]})')
    for _ in range(40):
        mk.sell(w, p, 'stone') or p.res.__setitem__('stone', p.res['stone'] + 1000)
    check(mk.prices(p)['stone'] == mk.PRICE_MIN, f'цена камня не ниже {mk.PRICE_MIN} ({mk.prices(p)["stone"]})')
    check(mk.prices(w.players[1])['food'] == 100, 'цены у каждого игрока свои')
    # Гильдии: сбор 15%
    w.apply_tech(p, 'guilds')
    check(mk.sell_price(p, 'food') == int(115 * 0.85), f'Гильдии: продажа по 85% ({mk.sell_price(p, "food")})')

    # ---- дань
    trib = buttons_by_tip(g, 'Дань')
    check(len(trib) == 4, f'4 кнопки дани союзнику ({len(trib)})')
    ally = w.players[1]
    g0, a0 = p.res['gold'], ally.res['gold']
    g.press_button(next(b for b in trib if b['tip'][1].get('gold')))
    check(p.res['gold'] == g0 - 130 and ally.res['gold'] == a0 + 100, 'дань 100 золота: списано 130, союзник +100')
    w.apply_tech(p, 'coinage')
    g0 = p.res['gold']
    mk.tribute(w, p, 1, 'gold')
    check(p.res['gold'] == g0 - 100, 'Чеканка монет: дань без сбора')
    check(not mk.tribute(w, p, 2, 'gold'), 'врагу дань нельзя')
    g.cmd_page = 0
    g.selected = [m1]
    g.draw()
    snap(g, os.path.join(a.out, 'market.png'), [m1], m1.center())

    # ---- мельница и пересев
    mlx, mly = free_spot(w, 'mill', sx, sy, 4)
    mill = w.place_building('mill', 0, mlx, mly, complete=True)
    g.selected = [mill]
    add = buttons_by_tip(g, 'Пересев')
    check(len(add) == 1, 'кнопка пересева на мельнице')
    w0 = p.res['wood']
    g.press_button(add[0])
    g.press_button(buttons_by_tip(g, 'Пересев')[0])
    check(mk.reseeds(p) == 2 and p.res['wood'] == w0 - 120, f'2 пересева оплачены заранее ({mk.reseeds(p)})')
    g.press_button(buttons_by_tip(g, 'Отменить')[0])
    check(mk.reseeds(p) == 1 and p.res['wood'] == w0 - 60, 'отмена пересева возвращает дерево')
    fx, fy = free_spot(w, 'farm', mlx, mly, 3)
    farm = w.place_building('farm', 0, fx, fy, complete=True)
    w.on_complete(farm)
    vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager')
    vil.x, vil.y = farm.center()
    vil.cmd_gather(farm)
    for _ in range(200):
        w.update(0.034)
    check(farm.farmer is vil and vil.state in ('gather', 'return'), 'фермер работает на ферме')
    farm.amount = 1.0
    newf = None
    for _ in range(4000):
        w.update(0.034)
        if not farm.alive:
            newf = next((b for b in w.buildings if b.kind == 'farm' and b.tx == fx and b.ty == fy and b.alive), None)
            if newf is not None and newf.complete and vil.target is newf and vil.state == 'gather':
                break
    check(not farm.alive, 'старая ферма истощилась')
    check(newf is not None, 'на её месте заложена новая ферма')
    check(newf is not None and newf.complete, 'фермер достроил новую ферму')
    check(newf is not None and vil.target is newf and vil.state == 'gather', 'фермер продолжил работу на новой')
    check(mk.reseeds(p) == 0, 'очередь пересева уменьшилась')
    snap(g, os.path.join(a.out, 'mill.png'), [mill], mill.center())

    # ---- торговая повозка между двумя своими рынками
    ox, oy = w.starts[0]
    tx = max(4, min(w.W - 8, ox + (22 if ox < w.W / 2 else -22)))
    m2x, m2y = free_spot(w, 'market', tx, oy, 1)
    m2 = w.place_building('market', 0, m2x, m2y, complete=True)
    d = mk.market_dist(m1, m2)
    cart = w.spawn(m1, 'trade_cart')
    p.pop += 1
    g.selected = [cart]
    g.command(*m2.center(), m2)
    check(cart.state == 'trade', f'повозка торгует (расстояние {d:.0f} клеток)')
    exp = mk.trade_gold(w, m1, m2)
    g0 = p.res['gold']
    got = None
    for _ in range(int(300 / 0.034)):
        w.update(0.034)
        if p.res['gold'] > g0:
            got = p.res['gold'] - g0
            break
    check(got is not None and abs(got - round(exp)) <= 1, f'рейс принёс {got} золота (ожидалось {exp:.1f}; '
          f'повозка {cart.state} ({cart.x / TILE:.0f},{cart.y / TILE:.0f}), рынки {m1.tx},{m1.ty} → {m2.tx},{m2.ty})')
    # скорость: Караван +50%
    s0 = cart.speed()
    w.apply_tech(p, 'caravan')
    check(abs(cart.speed() - s0 * 1.5) < 1e-6, 'Караван: +50% скорость повозки')
    for _ in range(200):
        w.update(0.034)
    snap(g, os.path.join(a.out, 'cart.png'), [cart], (cart.x, cart.y))

    # ---- технологии: числа
    from game.data import TECHS
    for k, cost, age in (('heavy_plow', {'food': 125, 'wood': 125}, 2), ('crop_rotation', {'food': 250, 'wood': 250}, 3),
                         ('bow_saw', {'food': 150, 'wood': 100}, 2), ('two_man_saw', {'food': 300, 'wood': 200}, 3),
                         ('gold_shaft', {'food': 200, 'wood': 150}, 2), ('stone_mining', {'food': 100, 'wood': 75}, 1),
                         ('stone_shaft', {'food': 200, 'wood': 150}, 2), ('hand_cart', {'food': 300, 'wood': 200}, 2),
                         ('town_watch', {'food': 75}, 1), ('town_patrol', {'food': 300, 'gold': 200}, 2)):
        check(TECHS[k]['cost'] == cost and TECHS[k]['age'] == age, f'{k}: цена и эпоха')
    base = vil.capacity()
    w.apply_tech(p, 'heavy_plow')
    check(vil.capacity() == base + 1, f'Тяжёлый плуг: груз фермера {base:g} → {vil.capacity():g}')
    pygame.quit()
    print('ИТОГ:', 'ошибки' if check.failed else 'всё в порядке')
    sys.exit(1 if check.failed else 0)


if __name__ == '__main__':
    main()
