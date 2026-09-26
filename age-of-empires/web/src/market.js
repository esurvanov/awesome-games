// port of game/market.py
// Market economy: resource trading, tribute to allies, trade carts, the farm reseed queue.
//
// The rules are as in the classic historical RTS:
//   * every player has their own prices for food, wood and stone (per 100 units), initially 100 gold each;
//     buying costs price x (1 + fee), selling yields price x (1 - fee), the fee is 30% (Guilds - 15%);
//     every purchase of 100 units raises the resource price by 3, a sale lowers it by 3; the price stays within 20...9999;
//   * tribute to an ally - in portions of 100, the sender pays a 30% fee on top (Coinage - no fee);
//     a completed market is needed;
//   * a trade cart goes between its own market and another (own or allied) market; at the other market
//     it receives gold, at home it hands it in. Gold per trip = 0.46 x d x (d / L + 0.3), d - the distance between
//     the markets in tiles, L - the map side; with an allied market +25%;
//   * farm reseeding: reseeds are paid for in advance at the mill (the farm's cost); when a farm with a farmer
//     is exhausted, a new one is laid in its place at once, and the farmer builds it and continues working.
//
// World events (World.emit):
//   'market'   x, y, owner, 'buy' | 'sell', resource
//   'tribute'  x, y, sender, receiver, resource, amount
//   'trade'    x, y, owner, unit kind, gold (a cart handed in gold)
//   'reseed'   x, y, owner, 'farm'
import * as py from '../runtime/py.js';
import { math } from '../runtime/py.js';
import * as i18n from './i18n.js';
import { TILE, RES_NAME } from './data.js';

export const GOODS = ['food', 'wood', 'stone'];     // what is traded at the market (for gold)
export const BASE_PRICE = 100;
export const PRICE_STEP = 3;
export const PRICE_MIN = 20, PRICE_MAX = 9999;
export const LOT = 100;                             // the portion of a purchase/sale/tribute
export const FEE = 0.30;                            // market fee (stat 'market_fee')
export const TRIBUTE_FEE = 0.30;                    // tribute fee (stat 'tribute_fee')
export const TRADE_K = 0.46;
export const ALLY_BONUS = 1.25;
export const MIN_TRADE_DIST = 10;                   // tiles between the markets

/** obj.__dict__.get(k, dflt): only the instance's own attribute. */
function _own(o, k, dflt = null) {
    return Object.hasOwn(o, k) ? o[k] : dflt;
}

// ------------------------------------------------------------ prices
/** The player's base prices {resource: gold per 100} (created on first access). */
export function prices(p) {
    let m = _own(p, 'market_price');
    if (m == null) {
        m = {};
        for (const r of GOODS) m[r] = BASE_PRICE;
        p.market_price = m;
    }
    return m;
}

export function fee(p) {
    return Math.max(0.0, p.stat('market_fee', 'market', FEE));
}

/** How much gold it costs to buy 100 units of r. */
export function buy_price(p, r) {
    return py.round(prices(p)[r] * (1 + fee(p)));
}

/** How much gold is given for 100 units of r. */
export function sell_price(p, r) {
    return Math.trunc(prices(p)[r] * (1 - fee(p)));
}

export function _shift(p, r, d) {
    const m = prices(p);
    m[r] = Math.max(PRICE_MIN, Math.min(PRICE_MAX, m[r] + d));
}

export function has_market(w, pid) {
    return w.buildings.some(b => b.owner === pid && b.kind === 'market' && b.complete && b.alive);
}

export function _market_of(w, pid) {
    const b = w.buildings.find(b => b.owner === pid && b.kind === 'market' && b.complete && b.alive);
    return b === undefined ? null : b;
}

/** Buy 100 units of r for gold. True - the deal went through. */
export function buy(w, p, r) {
    if (!GOODS.includes(r) || !has_market(w, p.id)) return false;
    const cost = buy_price(p, r);
    if (p.res['gold'] < cost) return false;
    p.res['gold'] -= cost;
    p.res[r] += LOT;
    _shift(p, r, PRICE_STEP);
    const b = _market_of(w, p.id);
    w.emit('market', ...b.center(), p.id, 'buy', r);
    return true;
}

/** Sell 100 units of r for gold. */
export function sell(w, p, r) {
    if (!GOODS.includes(r) || !has_market(w, p.id) || p.res[r] < LOT) return false;
    const gain = sell_price(p, r);
    p.res[r] -= LOT;
    p.res['gold'] += gain;
    _shift(p, r, -PRICE_STEP);
    const b = _market_of(w, p.id);
    w.emit('market', ...b.center(), p.id, 'sell', r);
    return true;
}

// ------------------------------------------------------------ tribute
export function tribute_fee(p) {
    return Math.max(0.0, p.stat('tribute_fee', 'market', TRIBUTE_FEE));
}

/** How much the sender will pay for amt units of tribute. */
export function tribute_cost(p, amt = LOT) {
    return py.round(amt * (1 + tribute_fee(p)));
}

/** Send the ally to (id) amt units of r. A completed market is needed. */
export function tribute(w, p, to, r, amt = LOT) {
    const q = w.players[to];
    if (to === p.id || !q.alive || !w.allied(p.id, to) || !has_market(w, p.id)) return false;
    const cost = tribute_cost(p, amt);
    if (p.res[r] < cost) return false;
    p.res[r] -= cost;
    q.res[r] += amt;
    const b = _market_of(w, p.id);
    w.emit('tribute', ...b.center(), p.id, to, r, amt);
    if (to === w.human) {
        w.msg(i18n.t('msg.tribute_from', { name: p.name, n: amt, res: RES_NAME[r].toLowerCase() }), [170, 230, 150]);
    } else if (p.id === w.human) {
        w.msg(i18n.t('msg.tribute_sent', { name: q.name, n: amt, res: RES_NAME[r].toLowerCase() }), [170, 230, 150]);
    }
    return true;
}

// ------------------------------------------------------------ trading with carts
/** The distance between the markets' centers in tiles. */
export function market_dist(a, b) {
    const [ax, ay] = a.center(), [bx, by] = b.center();
    return math.hypot(ax - bx, ay - by) / TILE;
}

/** Gold for one trip between the markets home and dest. */
export function trade_gold(w, home, dest) {
    const d = market_dist(home, dest);
    let g = TRADE_K * d * (d / Math.max(w.W, w.H) + 0.3);
    if (dest.owner !== home.owner) g *= ALLY_BONUS;
    if (home.p != null) g = home.p.stat('trade', 'trade_cart', g);     // civilization bonuses to trade gold ('mul')
    return g;
}

export function can_trade_with(w, u, m) {
    return (m != null && m.alive && m.kind === 'market' && m.complete &&
            w.allied(u.owner, m.owner));
}

/** An own market for a cart: the nearest one to it, other than dest. */
export function pick_home(w, u, dest) {
    let best = null, bd = 1e18;
    for (const b of w.buildings) {
        if (b.owner === u.owner && b.kind === 'market' && b.complete && b.alive && b !== dest) {
            const d = math.hypot(b.center()[0] - u.x, b.center()[1] - u.y);
            if (d < bd) {
                bd = d;
                best = b;
            }
        }
    }
    return best;
}

/** Send a cart to trade with the market dest. Returns the reason for refusal or ''. */
export function start_trade(w, u, dest) {
    if (!can_trade_with(w, u, dest)) return i18n.t('msg.trade_need_market');
    const home = pick_home(w, u, dest);
    if (home == null) return i18n.t('msg.trade_need_second');
    if (market_dist(home, dest) < MIN_TRADE_DIST) return i18n.t('msg.trade_too_close');
    u.release();
    u.trade_home = home;
    u.trade_dest = dest;
    u.target = u.carry <= 0 ? dest : home;
    u.state = 'trade';
    u.path_target = null;
    return '';
}

/** The 'trade' state (registered in world.UNIT_STATES). */
export function do_trade(u, w, dt) {
    let home = py.getattr(u, 'trade_home', null);
    const dest = py.getattr(u, 'trade_dest', null);
    if (!can_trade_with(w, u, dest)) {
        u.state = 'idle';
        u.target = null;
        return;
    }
    if (home == null || !home.alive || home.owner !== u.owner) {
        home = pick_home(w, u, dest);
        if (home == null || market_dist(home, dest) < MIN_TRADE_DIST) {
            u.state = 'idle';
            u.target = null;
            return;
        }
        u.trade_home = home;
        u.path_target = null;
    }
    const t = (u.target === home || u.target === dest) ? u.target : (u.carry > 0 ? home : dest);
    u.target = t;
    if (!u.approach(w, t, 24, dt)) return;
    if (t === dest) {
        u.carry = trade_gold(w, home, dest);
        u.carry_res = 'gold';
        u.target = home;
    } else {
        const amt = Math.trunc(u.carry + 0.5);
        if (amt > 0) {
            u.p.res['gold'] += amt;
            u.p.gathered['gold'] += amt;
            w.emit('trade', u.x, u.y, u.owner, u.kind, amt);
        }
        u.carry = 0;
        u.carry_res = null;
        u.target = dest;
    }
    u.path_target = null;
}

/** A right-click order for a cart: a market - trade, otherwise - move. */
export function trade_command(u, w, target, wx, wy) {
    if (target != null && py.getattr(target, 'kind', null) === 'market' && py.getattr(target, 'complete', false)) {
        const why = start_trade(w, u, target);
        if (!why) return 'trade';
        if (u.owner === w.human) w.msg(why, [255, 150, 90]);
        return null;
    }
    u.cmd_move(wx, wy);
    return 'move';
}

// ------------------------------------------------------------ farm reseeding
export function reseeds(p) {
    return _own(p, 'reseeds', 0);
}

/** Pay for n reseeds (the farm's cost each). Returns how many succeeded. */
export function queue_reseed(w, p, n = 1) {
    let done = 0;
    for (let i = 0; i < n; i++) {
        if (!p.pay(p.cost_of('bld', 'farm'))) break;
        p.reseeds = reseeds(p) + 1;
        done += 1;
    }
    return done;
}

export function cancel_reseed(w, p, n = 1) {
    let done = 0;
    for (let i = 0; i < n; i++) {
        if (reseeds(p) <= 0) break;
        p.reseeds -= 1;
        p.refund(p.cost_of('bld', 'farm'));
        done += 1;
    }
    return done;
}

/** A farm is exhausted (already removed from the map). If there is a paid reseed and a farmer - lay a new one. */
export function farm_expired(w, farm, farmer) {
    const p = w.players[farm.owner];
    if (reseeds(p) <= 0 || farmer == null || !farmer.alive || farmer.owner !== farm.owner) return null;
    if (!w.can_place('farm', farm.tx, farm.ty, farm.owner, false)) return null;
    p.reseeds -= 1;
    const nb = w.place_building('farm', farm.owner, farm.tx, farm.ty);
    farmer.cmd_build(nb);
    w.emit('reseed', ...nb.center(), farm.owner, 'farm');
    return nb;
}
