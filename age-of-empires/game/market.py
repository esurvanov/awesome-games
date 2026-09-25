"""Экономика рынка: торговля ресурсами, дань союзникам, торговые повозки, очередь пересева ферм.

Правила — как в классической исторической RTS:
  * у каждого игрока свои цены на еду, дерево и камень (за 100 единиц), в начале по 100 золота;
    покупка стоит цена × (1 + сбор), продажа приносит цена × (1 − сбор), сбор 30% (Гильдии — 15%);
    каждая покупка 100 единиц поднимает цену ресурса на 3, продажа — опускает на 3; цена в пределах 20…9999;
  * дань союзнику — порциями по 100, отправитель платит сбор 30% сверху (Чеканка монет — без сбора);
    нужен готовый рынок;
  * торговая повозка ходит между своим рынком и другим (своим или союзным) рынком; у чужого рынка
    получает золото, дома сдаёт его. Золото за рейс = 0.46 × d × (d / L + 0.3), d — расстояние между
    рынками в клетках, L — сторона карты; с союзным рынком +25%;
  * пересев ферм: на мельнице заранее оплачивают пересевы (цена фермы); когда ферма с фермером
    истощается, на её месте сразу закладывается новая, и фермер её строит и продолжает работу.

События мира (World.emit):
  'market'   x, y, владелец, 'buy' | 'sell', ресурс
  'tribute'  x, y, отправитель, получатель, ресурс, количество
  'trade'    x, y, владелец, вид юнита, золото (повозка сдала золото)
  'reseed'   x, y, владелец, 'farm'
"""
import math

from .data import TILE, RES_NAME

GOODS = ('food', 'wood', 'stone')     # чем торгуют на рынке (за золото)
BASE_PRICE = 100
PRICE_STEP = 3
PRICE_MIN, PRICE_MAX = 20, 9999
LOT = 100                             # партия покупки/продажи/дани
FEE = 0.30                            # сбор рынка (стат 'market_fee')
TRIBUTE_FEE = 0.30                    # сбор за дань (стат 'tribute_fee')
TRADE_K = 0.46
ALLY_BONUS = 1.25
MIN_TRADE_DIST = 10                   # клеток между рынками


# ------------------------------------------------------------ цены
def prices(p):
    """Базовые цены игрока {ресурс: золота за 100} (создаются при первом обращении)."""
    m = p.__dict__.get('market_price')
    if m is None:
        m = p.market_price = {r: BASE_PRICE for r in GOODS}
    return m


def fee(p):
    return max(0.0, p.stat('market_fee', 'market', FEE))


def buy_price(p, r):
    """Сколько золота стоит купить 100 единиц r."""
    return int(round(prices(p)[r] * (1 + fee(p))))


def sell_price(p, r):
    """Сколько золота дают за 100 единиц r."""
    return int(prices(p)[r] * (1 - fee(p)))


def _shift(p, r, d):
    m = prices(p)
    m[r] = max(PRICE_MIN, min(PRICE_MAX, m[r] + d))


def has_market(w, pid):
    return any(b.owner == pid and b.kind == 'market' and b.complete and b.alive for b in w.buildings)


def _market_of(w, pid):
    return next((b for b in w.buildings if b.owner == pid and b.kind == 'market' and b.complete and b.alive), None)


def buy(w, p, r):
    """Купить 100 единиц r за золото. True — сделка прошла."""
    if r not in GOODS or not has_market(w, p.id):
        return False
    cost = buy_price(p, r)
    if p.res['gold'] < cost:
        return False
    p.res['gold'] -= cost
    p.res[r] += LOT
    _shift(p, r, PRICE_STEP)
    b = _market_of(w, p.id)
    w.emit('market', *b.center(), p.id, 'buy', r)
    return True


def sell(w, p, r):
    """Продать 100 единиц r за золото."""
    if r not in GOODS or not has_market(w, p.id) or p.res[r] < LOT:
        return False
    gain = sell_price(p, r)
    p.res[r] -= LOT
    p.res['gold'] += gain
    _shift(p, r, -PRICE_STEP)
    b = _market_of(w, p.id)
    w.emit('market', *b.center(), p.id, 'sell', r)
    return True


# ------------------------------------------------------------ дань
def tribute_fee(p):
    return max(0.0, p.stat('tribute_fee', 'market', TRIBUTE_FEE))


def tribute_cost(p, amt=LOT):
    """Сколько заплатит отправитель за amt единиц дани."""
    return int(round(amt * (1 + tribute_fee(p))))


def tribute(w, p, to, r, amt=LOT):
    """Отправить союзнику to (id) amt единиц r. Нужен готовый рынок."""
    q = w.players[to]
    if to == p.id or not q.alive or not w.allied(p.id, to) or not has_market(w, p.id):
        return False
    cost = tribute_cost(p, amt)
    if p.res[r] < cost:
        return False
    p.res[r] -= cost
    q.res[r] += amt
    b = _market_of(w, p.id)
    w.emit('tribute', *b.center(), p.id, to, r, amt)
    if to == w.human:
        w.msg(f'{p.name}: дань {amt} ({RES_NAME[r].lower()})', (170, 230, 150))
    elif p.id == w.human:
        w.msg(f'Дань → {q.name}: {amt} ({RES_NAME[r].lower()})', (170, 230, 150))
    return True


# ------------------------------------------------------------ торговля повозками
def market_dist(a, b):
    """Расстояние между центрами рынков в клетках."""
    (ax, ay), (bx, by) = a.center(), b.center()
    return math.hypot(ax - bx, ay - by) / TILE


def trade_gold(w, home, dest):
    """Золото за один рейс между рынками home и dest."""
    d = market_dist(home, dest)
    g = TRADE_K * d * (d / max(w.W, w.H) + 0.3)
    if dest.owner != home.owner:
        g *= ALLY_BONUS
    if home.p is not None:
        g = home.p.stat('trade', 'trade_cart', g)     # бонусы цивилизаций к золоту торговли ('mul')
    return g


def can_trade_with(w, u, m):
    return (m is not None and m.alive and m.kind == 'market' and m.complete and
            w.allied(u.owner, m.owner))


def pick_home(w, u, dest):
    """Свой рынок для повозки: ближайший к ней, кроме dest."""
    best, bd = None, 1e18
    for b in w.buildings:
        if b.owner == u.owner and b.kind == 'market' and b.complete and b.alive and b is not dest:
            d = math.hypot(b.center()[0] - u.x, b.center()[1] - u.y)
            if d < bd:
                bd, best = d, b
    return best


def start_trade(w, u, dest):
    """Отправить повозку торговать с рынком dest. Возвращает причину отказа или ''."""
    if not can_trade_with(w, u, dest):
        return 'Нужен рынок: свой или союзный'
    home = pick_home(w, u, dest)
    if home is None:
        return 'Нужен второй рынок'
    if market_dist(home, dest) < MIN_TRADE_DIST:
        return 'Рынки слишком близко'
    u.release()
    u.trade_home = home
    u.trade_dest = dest
    u.target = dest if u.carry <= 0 else home
    u.state = 'trade'
    u.path_target = None
    return ''


def do_trade(u, w, dt):
    """Состояние 'trade' (регистрируется в world.UNIT_STATES)."""
    home = getattr(u, 'trade_home', None)
    dest = getattr(u, 'trade_dest', None)
    if not can_trade_with(w, u, dest):
        u.state = 'idle'
        u.target = None
        return
    if home is None or not home.alive or home.owner != u.owner:
        home = pick_home(w, u, dest)
        if home is None or market_dist(home, dest) < MIN_TRADE_DIST:
            u.state = 'idle'
            u.target = None
            return
        u.trade_home = home
        u.path_target = None
    t = u.target if u.target in (home, dest) else (home if u.carry > 0 else dest)
    u.target = t
    if not u.approach(w, t, 24, dt):
        return
    if t is dest:
        u.carry = trade_gold(w, home, dest)
        u.carry_res = 'gold'
        u.target = home
    else:
        amt = int(u.carry + 0.5)
        if amt > 0:
            u.p.res['gold'] += amt
            u.p.gathered['gold'] += amt
            w.emit('trade', u.x, u.y, u.owner, u.kind, amt)
        u.carry = 0
        u.carry_res = None
        u.target = dest
    u.path_target = None


def trade_command(u, w, target, wx, wy):
    """Приказ правой кнопкой для повозки: рынок — торговать, иначе — идти."""
    if target is not None and getattr(target, 'kind', None) == 'market' and getattr(target, 'complete', False):
        why = start_trade(w, u, target)
        if not why:
            return 'trade'
        if u.owner == w.human:
            w.msg(why, (255, 150, 90))
        return None
    u.cmd_move(wx, wy)
    return 'move'


# ------------------------------------------------------------ пересев ферм
def reseeds(p):
    return p.__dict__.get('reseeds', 0)


def queue_reseed(w, p, n=1):
    """Оплатить n пересевов (цена фермы каждый). Возвращает, сколько получилось."""
    done = 0
    for _ in range(n):
        if not p.pay(p.cost_of('bld', 'farm')):
            break
        p.reseeds = reseeds(p) + 1
        done += 1
    return done


def cancel_reseed(w, p, n=1):
    done = 0
    for _ in range(n):
        if reseeds(p) <= 0:
            break
        p.reseeds -= 1
        p.refund(p.cost_of('bld', 'farm'))
        done += 1
    return done


def farm_expired(w, farm, farmer):
    """Ферма истощилась (уже убрана с карты). Если есть оплаченный пересев и фермер — заложить новую."""
    p = w.players[farm.owner]
    if reseeds(p) <= 0 or farmer is None or not farmer.alive or farmer.owner != farm.owner:
        return None
    if not w.can_place('farm', farm.tx, farm.ty, farm.owner, check_explored=False):
        return None
    p.reseeds -= 1
    nb = w.place_building('farm', farm.owner, farm.tx, farm.ty)
    farmer.cmd_build(nb)
    w.emit('reseed', *nb.center(), farm.owner, 'farm')
    return nb
