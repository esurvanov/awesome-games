"""Market economy: resource trading, tribute to allies, trade carts, the farm reseed queue.

The rules are as in the classic historical RTS:
  * every player has their own prices for food, wood and stone (per 100 units), initially 100 gold each;
    buying costs price x (1 + fee), selling yields price x (1 - fee), the fee is 30% (Guilds - 15%);
    every purchase of 100 units raises the resource price by 3, a sale lowers it by 3; the price stays within 20...9999;
  * tribute to an ally - in portions of 100, the sender pays a 30% fee on top (Coinage - no fee);
    a completed market is needed;
  * a trade cart goes between its own market and another (own or allied) market; at the other market
    it receives gold, at home it hands it in. Gold per trip = 0.46 x d x (d / L + 0.3), d - the distance between
    the markets in tiles, L - the map side; with an allied market +25%;
  * farm reseeding: reseeds are paid for in advance at the mill (the farm's cost); when a farm with a farmer
    is exhausted, a new one is laid in its place at once, and the farmer builds it and continues working.

World events (World.emit):
  'market'   x, y, owner, 'buy' | 'sell', resource
  'tribute'  x, y, sender, receiver, resource, amount
  'trade'    x, y, owner, unit kind, gold (a cart handed in gold)
  'reseed'   x, y, owner, 'farm'
"""
import math

from . import i18n
from .data import TILE, RES_NAME

GOODS = ('food', 'wood', 'stone')     # what is traded at the market (for gold)
BASE_PRICE = 100
PRICE_STEP = 3
PRICE_MIN, PRICE_MAX = 20, 9999
LOT = 100                             # the portion of a purchase/sale/tribute
FEE = 0.30                            # market fee (stat 'market_fee')
TRIBUTE_FEE = 0.30                    # tribute fee (stat 'tribute_fee')
TRADE_K = 0.46
ALLY_BONUS = 1.25
MIN_TRADE_DIST = 10                   # tiles between the markets


# ------------------------------------------------------------ prices
def prices(p):
    """The player's base prices {resource: gold per 100} (created on first access)."""
    m = p.__dict__.get('market_price')
    if m is None:
        m = p.market_price = {r: BASE_PRICE for r in GOODS}
    return m


def fee(p):
    return max(0.0, p.stat('market_fee', 'market', FEE))


def buy_price(p, r):
    """How much gold it costs to buy 100 units of r."""
    return int(round(prices(p)[r] * (1 + fee(p))))


def sell_price(p, r):
    """How much gold is given for 100 units of r."""
    return int(prices(p)[r] * (1 - fee(p)))


def _shift(p, r, d):
    m = prices(p)
    m[r] = max(PRICE_MIN, min(PRICE_MAX, m[r] + d))


def has_market(w, pid):
    return any(b.owner == pid and b.kind == 'market' and b.complete and b.alive for b in w.buildings)


def _market_of(w, pid):
    return next((b for b in w.buildings if b.owner == pid and b.kind == 'market' and b.complete and b.alive), None)


def buy(w, p, r):
    """Buy 100 units of r for gold. True - the deal went through."""
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
    """Sell 100 units of r for gold."""
    if r not in GOODS or not has_market(w, p.id) or p.res[r] < LOT:
        return False
    gain = sell_price(p, r)
    p.res[r] -= LOT
    p.res['gold'] += gain
    _shift(p, r, -PRICE_STEP)
    b = _market_of(w, p.id)
    w.emit('market', *b.center(), p.id, 'sell', r)
    return True


# ------------------------------------------------------------ tribute
def tribute_fee(p):
    return max(0.0, p.stat('tribute_fee', 'market', TRIBUTE_FEE))


def tribute_cost(p, amt=LOT):
    """How much the sender will pay for amt units of tribute."""
    return int(round(amt * (1 + tribute_fee(p))))


def tribute(w, p, to, r, amt=LOT):
    """Send the ally to (id) amt units of r. A completed market is needed."""
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
        w.msg(i18n.t('msg.tribute_from', name=p.name, n=amt, res=RES_NAME[r].lower()), (170, 230, 150))
    elif p.id == w.human:
        w.msg(i18n.t('msg.tribute_sent', name=q.name, n=amt, res=RES_NAME[r].lower()), (170, 230, 150))
    return True


# ------------------------------------------------------------ trading with carts
def market_dist(a, b):
    """The distance between the markets' centers in tiles."""
    (ax, ay), (bx, by) = a.center(), b.center()
    return math.hypot(ax - bx, ay - by) / TILE


def trade_gold(w, home, dest):
    """Gold for one trip between the markets home and dest."""
    d = market_dist(home, dest)
    g = TRADE_K * d * (d / max(w.W, w.H) + 0.3)
    if dest.owner != home.owner:
        g *= ALLY_BONUS
    if home.p is not None:
        g = home.p.stat('trade', 'trade_cart', g)     # civilization bonuses to trade gold ('mul')
    return g


def can_trade_with(w, u, m):
    return (m is not None and m.alive and m.kind == 'market' and m.complete and
            w.allied(u.owner, m.owner))


def pick_home(w, u, dest):
    """An own market for a cart: the nearest one to it, other than dest."""
    best, bd = None, 1e18
    for b in w.buildings:
        if b.owner == u.owner and b.kind == 'market' and b.complete and b.alive and b is not dest:
            d = math.hypot(b.center()[0] - u.x, b.center()[1] - u.y)
            if d < bd:
                bd, best = d, b
    return best


def start_trade(w, u, dest):
    """Send a cart to trade with the market dest. Returns the reason for refusal or ''."""
    if not can_trade_with(w, u, dest):
        return i18n.t('msg.trade_need_market')
    home = pick_home(w, u, dest)
    if home is None:
        return i18n.t('msg.trade_need_second')
    if market_dist(home, dest) < MIN_TRADE_DIST:
        return i18n.t('msg.trade_too_close')
    u.release()
    u.trade_home = home
    u.trade_dest = dest
    u.target = dest if u.carry <= 0 else home
    u.state = 'trade'
    u.path_target = None
    return ''


def do_trade(u, w, dt):
    """The 'trade' state (registered in world.UNIT_STATES)."""
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
    """A right-click order for a cart: a market - trade, otherwise - move."""
    if target is not None and getattr(target, 'kind', None) == 'market' and getattr(target, 'complete', False):
        why = start_trade(w, u, target)
        if not why:
            return 'trade'
        if u.owner == w.human:
            w.msg(why, (255, 150, 90))
        return None
    u.cmd_move(wx, wy)
    return 'move'


# ------------------------------------------------------------ farm reseeding
def reseeds(p):
    return p.__dict__.get('reseeds', 0)


def queue_reseed(w, p, n=1):
    """Pay for n reseeds (the farm's cost each). Returns how many succeeded."""
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
    """A farm is exhausted (already removed from the map). If there is a paid reseed and a farmer - lay a new one."""
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
