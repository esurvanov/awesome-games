#!/usr/bin/env python3
"""A windowless economy check through the interface: the market (buy/sell, prices), tribute to an ally,
the farm reseed queue at the mill (a farm restores itself), a trade cart.
Screenshots - in --out (market.png, mill.png, cart.png).

  .venv/bin/python tools/eco_check.py --out shots/eco
Exit with a nonzero code if a check did not pass.
"""
import os
os.environ.setdefault('KHRONIKI_LANG', 'en')   # the tests match English UI texts
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
    raise RuntimeError('no room')


def buttons_by_tip(g, word):
    return [b for b in g.get_buttons() if word in b['tip'][0]]


def snap(g, path, sel, center):
    g.selected = sel
    g.center_on(*center)
    g.draw()
    pygame.image.save(g.screen, path)
    print('saved', path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='shots/eco')
    ap.add_argument('--seed', type=int, default=2)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    random.seed(a.seed)
    g = Game()
    g.new_game(1, 2, ally=True)          # 3 players: you + an ally (1) against 2
    w = g.world
    w.ais = []                           # the AI does not interfere with the check
    p = w.players[0]
    p.age = 2
    p.res = {'food': 2000, 'wood': 2000, 'gold': 2000, 'stone': 2000}
    sx, sy = w.starts[0]

    # ---- market
    mx, my = free_spot(w, 'market', sx, sy, 5)
    m1 = w.place_building('market', 0, mx, my, complete=True)
    g.selected = [m1]
    buy = buttons_by_tip(g, 'Buy')
    sell = buttons_by_tip(g, 'Sell')
    check(len(buy) == 3 and len(sell) == 3, f'the market has 3 buy buttons and 3 sell ({len(buy)}/{len(sell)})')
    bf = next(b for b in buy if 'food' in b['tip'][0])
    g0, f0 = p.res['gold'], p.res['food']
    check(mk.buy_price(p, 'food') == 130 and mk.sell_price(p, 'food') == 70, 'starting prices 130/70')
    g.press_button(bf)
    check(p.res['gold'] == g0 - 130 and p.res['food'] == f0 + 100, 'bought 100 food for 130 gold')
    check(mk.prices(p)['food'] == 103, f'the food price rose to 103 ({mk.prices(p)["food"]})')
    check(mk.buy_price(p, 'food') == 134, f'the next purchase 134 ({mk.buy_price(p, "food")})')
    for _ in range(4):
        g.press_button(next(b for b in buttons_by_tip(g, 'Buy') if 'food' in b['tip'][0]))
    check(mk.prices(p)['food'] == 115, f'after 5 purchases the price is 115 ({mk.prices(p)["food"]})')
    sw = next(b for b in buttons_by_tip(g, 'Sell') if 'wood' in b['tip'][0])
    g0, w0 = p.res['gold'], p.res['wood']
    g.press_button(sw)
    check(p.res['gold'] == g0 + 70 and p.res['wood'] == w0 - 100, 'sold 100 wood for 70 gold')
    check(mk.prices(p)['wood'] == 97, f'the wood price fell to 97 ({mk.prices(p)["wood"]})')
    for _ in range(40):
        mk.sell(w, p, 'stone') or p.res.__setitem__('stone', p.res['stone'] + 1000)
    check(mk.prices(p)['stone'] == mk.PRICE_MIN, f'the stone price is not below {mk.PRICE_MIN} ({mk.prices(p)["stone"]})')
    check(mk.prices(w.players[1])['food'] == 100, 'every player has their own prices')
    # Guilds: fee 15%
    w.apply_tech(p, 'guilds')
    check(mk.sell_price(p, 'food') == int(115 * 0.85), f'Guilds: selling at 85% ({mk.sell_price(p, "food")})')

    # ---- tribute
    trib = buttons_by_tip(g, 'Tribute')
    check(len(trib) == 4, f'4 tribute buttons to an ally ({len(trib)})')
    ally = w.players[1]
    g0, a0 = p.res['gold'], ally.res['gold']
    g.press_button(next(b for b in trib if b['tip'][1].get('gold')))
    check(p.res['gold'] == g0 - 130 and ally.res['gold'] == a0 + 100, 'tribute 100 gold: 130 deducted, the ally +100')
    w.apply_tech(p, 'coinage')
    g0 = p.res['gold']
    mk.tribute(w, p, 1, 'gold')
    check(p.res['gold'] == g0 - 100, 'Coinage: tribute without a fee')
    check(not mk.tribute(w, p, 2, 'gold'), 'no tribute to an enemy')
    g.cmd_page = 0
    g.selected = [m1]
    g.draw()
    snap(g, os.path.join(a.out, 'market.png'), [m1], m1.center())

    # ---- mill and reseeding
    mlx, mly = free_spot(w, 'mill', sx, sy, 4)
    mill = w.place_building('mill', 0, mlx, mly, complete=True)
    g.selected = [mill]
    add = buttons_by_tip(g, 'Reseed')
    check(len(add) == 1, 'the reseed button at the mill')
    w0 = p.res['wood']
    g.press_button(add[0])
    g.press_button(buttons_by_tip(g, 'Reseed')[0])
    check(mk.reseeds(p) == 2 and p.res['wood'] == w0 - 120, f'2 reseeds paid for in advance ({mk.reseeds(p)})')
    g.press_button(buttons_by_tip(g, 'Cancel')[0])
    check(mk.reseeds(p) == 1 and p.res['wood'] == w0 - 60, 'canceling a reseed returns the wood')
    fx, fy = free_spot(w, 'farm', mlx, mly, 3)
    farm = w.place_building('farm', 0, fx, fy, complete=True)
    w.on_complete(farm)
    vil = next(u for u in w.units if u.owner == 0 and u.kind == 'villager')
    vil.x, vil.y = farm.center()
    vil.cmd_gather(farm)
    for _ in range(200):
        w.update(0.034)
    check(farm.farmer is vil and vil.state in ('gather', 'return'), 'a farmer works on the farm')
    farm.amount = 1.0
    newf = None
    for _ in range(4000):
        w.update(0.034)
        if not farm.alive:
            newf = next((b for b in w.buildings if b.kind == 'farm' and b.tx == fx and b.ty == fy and b.alive), None)
            if newf is not None and newf.complete and vil.target is newf and vil.state == 'gather':
                break
    check(not farm.alive, 'the old farm was exhausted')
    check(newf is not None, 'a new farm was laid in its place')
    check(newf is not None and newf.complete, 'the farmer finished the new farm')
    check(newf is not None and vil.target is newf and vil.state == 'gather', 'the farmer continued working on the new one')
    check(mk.reseeds(p) == 0, 'the reseed queue got shorter')
    snap(g, os.path.join(a.out, 'mill.png'), [mill], mill.center())

    # ---- a trade cart between two own markets
    ox, oy = w.starts[0]
    tx = max(4, min(w.W - 8, ox + (22 if ox < w.W / 2 else -22)))
    m2x, m2y = free_spot(w, 'market', tx, oy, 1)
    m2 = w.place_building('market', 0, m2x, m2y, complete=True)
    d = mk.market_dist(m1, m2)
    cart = w.spawn(m1, 'trade_cart')
    p.pop += 1
    g.selected = [cart]
    g.command(*m2.center(), m2)
    check(cart.state == 'trade', f'the cart trades (distance {d:.0f} tiles)')
    exp = mk.trade_gold(w, m1, m2)
    g0 = p.res['gold']
    got = None
    for _ in range(int(300 / 0.034)):
        w.update(0.034)
        if p.res['gold'] > g0:
            got = p.res['gold'] - g0
            break
    check(got is not None and abs(got - round(exp)) <= 1, f'a trip brought {got} gold (expected {exp:.1f}; '
          f'cart {cart.state} ({cart.x / TILE:.0f},{cart.y / TILE:.0f}), markets {m1.tx},{m1.ty} → {m2.tx},{m2.ty})')
    # speed: Caravan +50%
    s0 = cart.speed()
    w.apply_tech(p, 'caravan')
    check(abs(cart.speed() - s0 * 1.5) < 1e-6, 'Caravan: +50% cart speed')
    for _ in range(200):
        w.update(0.034)
    snap(g, os.path.join(a.out, 'cart.png'), [cart], (cart.x, cart.y))

    # ---- techs: numbers
    from game.data import TECHS
    for k, cost, age in (('heavy_plow', {'food': 125, 'wood': 125}, 2), ('crop_rotation', {'food': 250, 'wood': 250}, 3),
                         ('bow_saw', {'food': 150, 'wood': 100}, 2), ('two_man_saw', {'food': 300, 'wood': 200}, 3),
                         ('gold_shaft', {'food': 200, 'wood': 150}, 2), ('stone_mining', {'food': 100, 'wood': 75}, 1),
                         ('stone_shaft', {'food': 200, 'wood': 150}, 2), ('hand_cart', {'food': 300, 'wood': 200}, 2),
                         ('town_watch', {'food': 75}, 1), ('town_patrol', {'food': 300, 'gold': 200}, 2)):
        check(TECHS[k]['cost'] == cost and TECHS[k]['age'] == age, f'{k}: cost and age')
    base = vil.capacity()
    w.apply_tech(p, 'heavy_plow')
    check(vil.capacity() == base + 1, f'Heavy Plow: farmer load {base:g} → {vil.capacity():g}')
    pygame.quit()
    print('RESULT:', 'errors' if check.failed else 'all good')
    sys.exit(1 if check.failed else 0)


if __name__ == '__main__':
    main()
