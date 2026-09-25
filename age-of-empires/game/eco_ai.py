"""Экономика компьютерного игрока: мельница у ферм, рынок, торговля излишками, экономические
технологии, очередь пересева ферм, торговые повозки к союзным рынкам.

Вызывается из AI.update каждые 0.5 с: eco_ai.update(ai, ...); своё состояние держит в ai.eco.
"""
from collections import Counter

from .data import TILE, TECHS
from . import market as mk

# (технология, условие) в порядке важности; условие получает сводку c (см. update)
ECO_TECHS = [
    ('wheelbarrow', lambda c: c['nv'] >= 14),
    ('double_bit', lambda c: c['wood'] >= 4),
    ('horse_collar', lambda c: c['farms'] >= 3),
    ('gold_mining', lambda c: c['gold'] >= 3),
    ('stone_mining', lambda c: c['stone'] >= 3),
    ('heavy_plow', lambda c: c['farms'] >= 5),
    ('bow_saw', lambda c: c['wood'] >= 5),
    ('hand_cart', lambda c: c['nv'] >= 24),
    ('gold_shaft', lambda c: c['gold'] >= 5),
    ('stone_shaft', lambda c: c['stone'] >= 4),
    ('caravan', lambda c: c['carts'] >= 3),
    ('crop_rotation', lambda c: c['farms'] >= 6),
    ('two_man_saw', lambda c: c['wood'] >= 6),
    ('guilds', lambda c: c['trades'] >= 25),
]


def update(ai, units, vils, blds, count, done, reserve, tc):
    st = ai.__dict__.setdefault('eco', {'t': 1.0, 'trades': 0})
    st['t'] -= 0.5
    if st['t'] > 0 or not vils:
        return
    st['t'] = 2.0
    w, p = ai.w, ai.p
    c = Counter()
    for v in vils:
        r = ai.vil_task(v)
        if r:
            c[r] += 1
    c['nv'] = len(vils)
    c['farms'] = done['farm']
    c['carts'] = sum(1 for u in units if u.kind == 'trade_cart')
    c['trades'] = st['trades']
    build(ai, vils, count, done, reserve, c)
    research(ai, blds, reserve, c)
    if done['market']:
        trade(ai, st, count, reserve)
        carts(ai, units, blds, reserve, c)
    if done['farm'] >= 3 and done['mill']:
        want = max(2, done['farm'] // 3)
        cost = p.cost_of('bld', 'farm')
        if mk.reseeds(p) < want and p.afford({k: v + 100 for k, v in cost.items()}, reserve):
            mk.queue_reseed(w, p)


def _spend_ok(p, cost, reserve):
    """Хватает ли, не трогая запас на эпоху — только по тем ресурсам, что нужны самой покупке."""
    return all(p.res[r] >= v + reserve.get(r, 0) for r, v in cost.items())


def _invest_ok(p, cost, reserve):
    """Вложение в экономику (технология, повозка) окупается быстро: запас на эпоху бережём,
    только когда он почти собран (80%)."""
    close = bool(reserve) and all(p.res[r] >= 0.8 * v for r, v in reserve.items())
    return _spend_ok(p, cost, reserve) if close else p.afford(cost)


def build(ai, vils, count, done, reserve, c):
    p = ai.p
    bx, by = ai.base.center()
    btx, bty = int(bx // TILE), int(by // TILE)
    # мельница у ферм (для технологий и пересева), если ягодной не было
    if count['mill'] == 0 and c['farms'] >= 2 and p.age >= 1:
        cost = p.cost_of('bld', 'mill')
        if _spend_ok(p, cost, reserve):
            spot = ai.find_spot('mill', btx, bty, 4, 10)
            if spot:
                ai.start_build('mill', spot, vils, 1)
                return
    # рынок: в Феодальную при большой экономике, в Замках — всегда
    has_market = any(b.kind == 'market' and b.owner == p.id for b in ai.w.buildings)    # count мог устареть
    if not has_market and p.age >= 1 and (p.age >= 2 or c['nv'] >= 32 or
                                                   p.res['gold'] + p.res['stone'] >= 900):
        cost = p.cost_of('bld', 'market')
        if _spend_ok(p, cost, reserve):
            spot = ai.find_spot('market', btx, bty, 6, 18)
            if spot:
                ai.start_build('market', spot, vils, 2)


def research(ai, blds, reserve, c):
    w, p = ai.w, ai.p
    for name, cond in ECO_TECHS:
        if name in p.techs or name in p.researching or name not in TECHS or not cond(c):
            continue
        ok, _ = w.tech_state(p, name)
        if not ok:
            continue
        host = next((b for b in blds if b.complete and name in b.d.get('techs', []) and len(b.queue) < 2), None)
        if host is None:
            continue
        cost = p.cost_of('tech', name)
        if _invest_ok(p, cost, reserve):
            p.pay(cost)
            host.queue.append(('tech', name))
            p.researching.add(name)
            return


def trade(ai, st, count, reserve):
    """Продать излишки (камень, еду/дерево сверх нормы) и купить недостающее за лишнее золото."""
    w, p = ai.w, ai.p
    castle_plan = p.age >= 2 and ai.diff >= 1 and count['castle'] < 1
    want = {'food': 400 + 100 * p.age, 'wood': 300 + 50 * p.age, 'gold': 250,
            'stone': 700 if castle_plan else 150}
    for r, v in reserve.items():
        want[r] = want.get(r, 0) + v
    for _ in range(3):
        did = False
        # продажа: заметный излишек и цена не бросовая
        for r in mk.GOODS:
            extra = p.res[r] - want[r]
            limit = 200 if r == 'stone' else 900
            if extra >= limit and mk.sell_price(p, r) >= 30 and mk.sell(w, p, r):
                st['trades'] += 1
                did = True
                break
        # покупка: самый нужный из еды/дерева, если золота больше нормы
        need = sorted((r for r in ('food', 'wood') if p.res[r] < want[r]), key=lambda r: p.res[r] - want[r])
        for r in need:
            price = mk.buy_price(p, r)
            if price <= 300 and p.res['gold'] - want['gold'] >= price and mk.buy(w, p, r):
                st['trades'] += 1
                did = True
                break
        if not did:
            break


def carts(ai, units, blds, reserve, c):
    """Торговые повозки — только к союзным рынкам (свой рынок у ИИ один)."""
    w, p = ai.w, ai.p
    if p.age < 2:
        return
    allied = [b for b in w.buildings if b.kind == 'market' and b.complete and b.owner != p.id
              and w.allied(p.id, b.owner)]
    home = next((b for b in blds if b.kind == 'market' and b.complete), None)
    if not allied or home is None:
        return
    allied = [b for b in allied if mk.market_dist(home, b) >= mk.MIN_TRADE_DIST]
    if not allied:
        return
    dest = max(allied, key=lambda b: mk.market_dist(home, b))
    for u in units:
        if u.kind == 'trade_cart' and u.state == 'idle':
            mk.start_trade(w, u, dest)
    target = 4 if p.age == 2 else 8
    q = sum(1 for k, n in home.queue if n == 'trade_cart')
    if c['carts'] + q < target and not home.queue and p.pop < p.cap:
        cost = p.cost_of('unit', 'trade_cart')
        if _invest_ok(p, cost, reserve):
            p.pay(cost)
            home.queue.append(('unit', 'trade_cart'))
