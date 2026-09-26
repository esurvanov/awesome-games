// port of game/economy_ui.py
/* Economy interface: market buttons (buy/sell/tribute), the reseed queue at the mill, panels.

   The buttons are ordinary items for Game.layout_buttons: icon=('draw', fn(game, rect, ok)), act=('call', fn(game)). */
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as i18n from './i18n.js';
import { RES_NAME, shade } from './data.js';
import * as mk from './market.js';

export const UP = [120, 220, 110];
export const DOWN = [235, 110, 90];


export function _arrow(scr, x, y, up, color, s = 5) {
    let pts;
    if (up) {
        pts = [[x, y - s], [x + s, y + py.floordiv(s, 2)], [x - s, y + py.floordiv(s, 2)]];
    } else {
        pts = [[x, y + s], [x + s, y - py.floordiv(s, 2)], [x - s, y - py.floordiv(s, 2)]];
    }
    pygame.draw.polygon(scr, color, pts);
    pygame.draw.polygon(scr, [25, 20, 15], pts, 1);
}


export function _shift_n(game) {
    return (game.mods() & pygame.KMOD_SHIFT) ? 5 : 1;
}


// ------------------------------------------------------------ market
export function _trade_btn(r, buying) {
    const draw = (game, rect, ok) => {
        const p = game.world.players[0];
        game.res_icon(r, rect.centerx - 7, rect.y + 16, 9);
        _arrow(game.screen, rect.right - 10, rect.y + 15, buying, buying ? UP : DOWN, 6);
        const price = buying ? mk.buy_price(p, r) : mk.sell_price(p, r);
        game.res_icon('gold', rect.x + 9, rect.bottom - 11, 5);
        game.text(String(price), [rect.x + 16, rect.bottom - 11], 's', ok ? [255, 235, 150] : [150, 140, 120],
            'midleft');
    };

    const act = (game) => {
        const w = game.world;
        const p = w.players[0];
        const fn = buying ? mk.buy : mk.sell;
        let done = 0;
        const n = _shift_n(game);
        for (let i = 0; i < n; i++) if (fn(w, p, r)) done += 1;
        if (!done) w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
    };
    return [draw, act];
}


export function _tribute_btn(ally, r) {
    const draw = (game, rect, ok) => {
        const q = game.world.players[ally];
        game.res_icon(r, rect.centerx - 8, rect.centery - 4, 9);
        const cx = rect.right - 12, cy = rect.y + 13;
        pygame.draw.circle(game.screen, q.color, [cx, cy], 7);
        pygame.draw.circle(game.screen, [240, 235, 220], [cx, cy], 7, 1);
        pygame.draw.polygon(game.screen, [240, 235, 220], [[rect.centerx + 2, rect.bottom - 16],
            [rect.centerx + 10, rect.bottom - 12],
            [rect.centerx + 2, rect.bottom - 8]]);
        game.text(String(mk.LOT), [rect.x + 5, rect.bottom - 12], 's', ok ? [230, 225, 210] : [150, 140, 120],
            'midleft');
    };

    const act = (game) => {
        const w = game.world;
        const p = w.players[0];
        let done = 0;
        const n = _shift_n(game);
        for (let i = 0; i < n; i++) if (mk.tribute(w, p, ally, r)) done += 1;
        if (!done) w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
    };
    return [draw, act];
}


export function market_buttons(game, b, p) {
    const w = game.world;
    const items = [];
    for (const buying of [true, false]) {
        for (const r of mk.GOODS) {
            const [draw, act] = _trade_btn(r, buying);
            let cost, ok, tip;
            if (buying) {
                cost = { gold: mk.buy_price(p, r) };
                ok = p.res['gold'] >= cost['gold'];
                tip = [i18n.t('eco.buy', { res: RES_NAME[r].toLowerCase() }), cost, `+${mk.LOT}`, ['dim', i18n.t('eco.shift_x5')]];
            } else {
                cost = { [r]: mk.LOT };
                ok = p.res[r] >= mk.LOT;
                tip = [i18n.t('eco.sell', { res: RES_NAME[r].toLowerCase() }), cost,
                    `+${mk.sell_price(p, r)} ${RES_NAME['gold'].toLowerCase()}`, ['dim', i18n.t('eco.shift_x5')]];
            }
            items.push({ icon: ['draw', draw], act: ['call', act], ok: ok, tip: tip });
        }
    }
    for (const q of w.players) {
        if (q.id === p.id || !q.alive || !w.allied(p.id, q.id)) continue;
        for (const r of ['gold', 'food', 'wood', 'stone']) {
            const [draw, act] = _tribute_btn(q.id, r);
            const cost = { [r]: mk.tribute_cost(p) };
            items.push({
                icon: ['draw', draw], act: ['call', act], ok: p.res[r] >= cost[r],
                tip: [i18n.t('eco.tribute_to', { name: q.name }), cost, `+${mk.LOT} ${RES_NAME[r].toLowerCase()}`,
                    ['dim', i18n.t('win.fee', { n: Math.trunc(py.round(mk.tribute_fee(p) * 100)) })]],
            });
        }
    }
    return items;
}


/** Market prices: the resource, buy ▲, sell ▼ and a price level bar. */
export function market_panel(game, b, x, y) {
    if (b.owner !== 0) return;
    const p = game.world.players[0];
    const scr = game.screen;
    mk.GOODS.forEach((r, i) => {
        const cx = x + i * 150;
        game.res_icon(r, cx + 8, y);
        _arrow(scr, cx + 26, y, true, UP, 4);
        game.text(String(mk.buy_price(p, r)), [cx + 33, y], 'b', undefined, 'midleft');
        _arrow(scr, cx + 76, y, false, DOWN, 4);
        game.text(String(mk.sell_price(p, r)), [cx + 83, y], 'b', undefined, 'midleft');
        const lvl = Math.min(1.0, mk.prices(p)[r] / 300);
        pygame.draw.rect(scr, [25, 20, 18], [cx, y + 12, 120, 4]);
        pygame.draw.rect(scr, shade([240, 200, 40], -40 + Math.trunc(60 * lvl)), [cx, y + 12, Math.trunc(120 * lvl), 4]);
    });
    const carts = game.world.units.filter(u => u.owner === 0 && u.kind === 'trade_cart');
    if (carts.length) {
        const trading = carts.filter(u => u.state === 'trade').length;
        const ic = game.icon('u', 'trade_cart', 0, 26);
        scr.blit(ic, [x + 450, y - 14]);
        game.text(`${trading}/${carts.length}`, [x + 478, y], 'b', undefined, 'midleft');
    }
}


// ------------------------------------------------------------ mill: reseeding
export function _farm_icon(game, rect, sign) {
    const img = game.icon('b', 'farm', 0, 42);
    game.screen.blit(img, img.get_rect({ center: [rect.centerx - 4, rect.centery + 2] }));
    const cx = rect.right - 11, cy = rect.y + 11;
    pygame.draw.circle(game.screen, sign > 0 ? [60, 140, 60] : [160, 60, 50], [cx, cy], 7);
    pygame.draw.line(game.screen, [250, 250, 240], [cx - 4, cy], [cx + 4, cy], 2);
    if (sign > 0) pygame.draw.line(game.screen, [250, 250, 240], [cx, cy - 4], [cx, cy + 4], 2);
}


export function _reseed_add(game) {
    const w = game.world;
    if (!mk.queue_reseed(w, w.players[0], _shift_n(game))) {
        w.msg(i18n.t('msg.not_enough_resources'), [255, 150, 90]);
    }
}


export function _reseed_del(game) {
    const w = game.world;
    mk.cancel_reseed(w, w.players[0], _shift_n(game));
}


export function mill_buttons(game, b, p) {
    const n = mk.reseeds(p);
    const cost = p.cost_of('bld', 'farm');

    const draw_add = (g, rect, ok) => {
        _farm_icon(g, rect, 1);
        g.text(String(n), [rect.x + 5, rect.bottom - 12], 'b', [255, 235, 150], 'midleft');
    };

    const items = [{
        icon: ['draw', draw_add], act: ['call', _reseed_add], ok: p.afford(cost),
        tip: [i18n.t('eco.reseed'), cost, i18n.t('eco.reseed_desc'), ['dim', i18n.t('eco.queued', { n: n })]],
    }];
    if (n) {
        items.push({
            icon: ['draw', (g, rect, ok) => _farm_icon(g, rect, -1)], act: ['call', _reseed_del],
            ok: true, tip: [i18n.t('eco.reseed_cancel'), {}, i18n.t('eco.reseed_cancel_desc')],
        });
    }
    return items;
}


export function mill_panel(game, b, x, y) {
    if (b.owner !== 0) return;
    const n = mk.reseeds(game.world.players[0]);
    const img = game.icon('b', 'farm', 0, 28);
    game.screen.blit(img, [x, y - 14]);
    game.text(`×${n}`, [x + 32, y], 'b', n ? [255, 235, 150] : [170, 160, 140], 'midleft');
}


// ------------------------------------------------------------ trade cart
export function cart_panel(game, u, x, y) {
    if (u.carry >= 1) {
        game.res_icon('gold', x + 8, y + 30);
        game.text(String(Math.trunc(u.carry)), [x + 20, y + 30], 'b', undefined, 'midleft');
    }
    if (u.state === 'trade') {
        const dest = py.getattr(u, 'trade_dest', null);
        if (dest != null) {
            const gold = py.bool(py.getattr(u, 'trade_home', null)) ? mk.trade_gold(game.world, u.trade_home, dest) : 0;
            const col = game.world.players[dest.owner].color;
            pygame.draw.circle(game.screen, col, [x + 90, y + 30], 6);
            game.text(`→ ${Math.trunc(gold)}`, [x + 102, y + 30], 'b', [255, 235, 150], 'midleft');
        }
    }
}
