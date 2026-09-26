// port of game/eco_ai.py
// Computer player's economy: a mill by the farms, a market, trading surpluses, economic
// techs, the farm reseed queue, trade carts to allied markets.
//
// Called from AI.update every 0.5 s: eco_ai.update(ai, ...); keeps its own state in ai.eco.
import * as py from '../runtime/py.js';
import { TILE, TECHS } from './data.js';
import * as mk from './market.js';

// (tech, condition) in order of importance; the condition receives a summary c (see update)
export const ECO_TECHS = [
    ['wheelbarrow', c => c.get('nv') >= 14],
    ['double_bit', c => c.get('wood') >= 4],
    ['horse_collar', c => c.get('farms') >= 3],
    ['gold_mining', c => c.get('gold') >= 3],
    ['stone_mining', c => c.get('stone') >= 3],
    ['heavy_plow', c => c.get('farms') >= 5],
    ['bow_saw', c => c.get('wood') >= 5],
    ['hand_cart', c => c.get('nv') >= 24],
    ['gold_shaft', c => c.get('gold') >= 5],
    ['stone_shaft', c => c.get('stone') >= 4],
    ['caravan', c => c.get('carts') >= 3],
    ['crop_rotation', c => c.get('farms') >= 6],
    ['two_man_saw', c => c.get('wood') >= 6],
    ['guilds', c => c.get('trades') >= 25],
];

export function update(ai, units, vils, blds, count, done, reserve, tc) {
    let st = ai.eco;
    if (st === undefined) st = ai.eco = { t: 1.0, trades: 0 };
    st['t'] -= 0.5;
    if (st['t'] > 0 || !vils.length) return;
    st['t'] = 2.0;
    const w = ai.w, p = ai.p;
    const c = new py.Counter();
    for (const v of vils) {
        const r = ai.vil_task(v);
        if (r) c.inc(r);
    }
    c.set('nv', vils.length);
    c.set('farms', done.get('farm'));
    let carts_n = 0;
    for (const u of units) if (u.kind === 'trade_cart') carts_n += 1;
    c.set('carts', carts_n);
    c.set('trades', st['trades']);
    build(ai, vils, count, done, reserve, c);
    research(ai, blds, reserve, c);
    if (done.get('market')) {
        trade(ai, st, count, reserve);
        carts(ai, units, blds, reserve, c);
    }
    if (done.get('farm') >= 3 && done.get('mill')) {
        const want = Math.max(2, Math.floor(done.get('farm') / 3));
        const cost = p.cost_of('bld', 'farm');
        const plus = {};
        for (const [k, v] of Object.entries(cost)) plus[k] = v + 100;
        if (mk.reseeds(p) < want && p.afford(plus, reserve)) mk.queue_reseed(w, p);
    }
}

export function _spend_ok(p, cost, reserve) {
    // Whether it is affordable without touching the age reserve - only for the resources the purchase itself needs.
    for (const [r, v] of Object.entries(cost)) {
        if (!(p.res[r] >= v + py.get(reserve, r, 0))) return false;
    }
    return true;
}

export function _invest_ok(p, cost, reserve) {
    // An investment in the economy (a tech, a cart) pays back fast: the age reserve is protected
    // only when it is almost collected (80%).
    const close = py.bool(reserve) && Object.entries(reserve).every(([r, v]) => p.res[r] >= 0.8 * v);
    return close ? _spend_ok(p, cost, reserve) : p.afford(cost);
}

export function build(ai, vils, count, done, reserve, c) {
    const p = ai.p;
    const [bx, by] = ai.base.center();
    const btx = Math.floor(bx / TILE), bty = Math.floor(by / TILE);
    // a mill by the farms (for techs and reseeding), if there was no berry one
    if (count.get('mill') === 0 && c.get('farms') >= 2 && p.age >= 1) {
        const cost = p.cost_of('bld', 'mill');
        if (_spend_ok(p, cost, reserve)) {
            const spot = ai.find_spot('mill', btx, bty, 4, 10);
            if (spot) {
                ai.start_build('mill', spot, vils, 1);
                return;
            }
        }
    }
    // market: in the Feudal Age with a large economy, in the Castle Age - always
    const has_market = ai.w.buildings.some(b => b.kind === 'market' && b.owner === p.id);    // count may be stale
    if (!has_market && p.age >= 1 && (p.age >= 2 || c.get('nv') >= 32 ||
                                      p.res['gold'] + p.res['stone'] >= 900)) {
        const cost = p.cost_of('bld', 'market');
        if (_spend_ok(p, cost, reserve)) {
            const spot = ai.find_spot('market', btx, bty, 6, 18);
            if (spot) ai.start_build('market', spot, vils, 2);
        }
    }
}

export function research(ai, blds, reserve, c) {
    const w = ai.w, p = ai.p;
    for (const [name, cond] of ECO_TECHS) {
        if (py.contains(p.techs, name) || py.contains(p.researching, name) || !Object.hasOwn(TECHS, name) || !cond(c)) continue;
        const [ok] = w.tech_state(p, name);
        if (!ok) continue;
        const host = blds.find(b => b.complete && py.get(b.d, 'techs', []).includes(name) && b.queue.length < 2);
        if (host === undefined) continue;
        const cost = p.cost_of('tech', name);
        if (_invest_ok(p, cost, reserve)) {
            p.pay(cost);
            host.queue.push(['tech', name]);
            p.researching.add(name);
            return;
        }
    }
}

export function trade(ai, st, count, reserve) {
    // Sell surpluses (stone, food/wood above the norm) and buy what is missing with the extra gold.
    const w = ai.w, p = ai.p;
    const castle_plan = p.age >= 2 && ai.diff >= 1 && count.get('castle') < 1;
    const want = {
        food: 400 + 100 * p.age, wood: 300 + 50 * p.age, gold: 250,
        stone: castle_plan ? 700 : 150,
    };
    for (const [r, v] of Object.entries(reserve)) want[r] = py.get(want, r, 0) + v;
    for (let i = 0; i < 3; i++) {
        let did = false;
        // selling: a noticeable surplus and the price is not throwaway
        for (const r of mk.GOODS) {
            const extra = p.res[r] - want[r];
            const limit = r === 'stone' ? 200 : 900;
            if (extra >= limit && mk.sell_price(p, r) >= 30 && mk.sell(w, p, r)) {
                st['trades'] += 1;
                did = true;
                break;
            }
        }
        // buying: the most needed of food/wood if there is more gold than the norm
        const need = py.sorted(['food', 'wood'].filter(r => p.res[r] < want[r]), r => p.res[r] - want[r]);
        for (const r of need) {
            const price = mk.buy_price(p, r);
            if (price <= 300 && p.res['gold'] - want['gold'] >= price && mk.buy(w, p, r)) {
                st['trades'] += 1;
                did = true;
                break;
            }
        }
        if (!did) break;
    }
}

export function carts(ai, units, blds, reserve, c) {
    // Trade carts - only to allied markets (the AI has just one market of its own).
    const w = ai.w, p = ai.p;
    if (p.age < 2) return;
    let allied = w.buildings.filter(b => b.kind === 'market' && b.complete && b.owner !== p.id
                                         && w.allied(p.id, b.owner));
    const home = blds.find(b => b.kind === 'market' && b.complete) ?? null;
    if (!allied.length || home == null) return;
    allied = allied.filter(b => mk.market_dist(home, b) >= mk.MIN_TRADE_DIST);
    if (!allied.length) return;
    const dest = py.max(allied, b => mk.market_dist(home, b));
    for (const u of units) {
        if (u.kind === 'trade_cart' && u.state === 'idle') mk.start_trade(w, u, dest);
    }
    const target = p.age === 2 ? 4 : 8;
    let q = 0;
    for (const [, n] of home.queue) if (n === 'trade_cart') q += 1;
    if (c.get('carts') + q < target && !home.queue.length && p.pop < p.cap) {
        const cost = p.cost_of('unit', 'trade_cart');
        if (_invest_ok(p, cost, reserve)) {
            p.pay(cost);
            home.queue.push(['unit', 'trade_cart']);
        }
    }
}
