// port of game/content/economy.py
// Full economy: the market, the trade cart, economic techs, farm reseeding.
// Numbers follow the classic historical RTS (Definitive Edition). Logic - market.js, interface buttons and
// panels - economy_ui.js, AI - eco_ai.js.
import { modules } from '../../runtime/py.js';
import * as pygame from '../../runtime/pygame.js';
import { add_unit, add_building, add_tech } from './__init__.js';
import { TECHS, AGE_REQ, BUILDINGS } from '../data.js';
import * as market from '../market.js';

const int = Math.trunc;

// gfx.IsoPainter: box(x0, y0, x1, y1, h, color, z0=0.0, top=True, tex=None), poly(pts, color, outline=True),
// line(a, b, color, w=1), gable(x0, y0, x1, y1, z, rh, color, wall, axis='x', ov=0.1)

// ============================================================ graphics
export function _market_art(p, surf, color, s) {
    const { PLASTER, WOOD, ROOF_RED, shade } = modules.gfx;
    // paved square
    p.poly([[0.08, 0.08], [s - 0.08, 0.08], [s - 0.08, s - 0.08], [0.08, s - 0.08]], [176, 160, 128], false);
    for (let i = 1; i < 8; i++) {
        const t = s * i / 8;
        p.line([t, 0.1, 0], [t, s - 0.1, 0], [158, 142, 112]);
        p.line([0.1, t, 0], [s - 0.1, t, 0], [158, 142, 112]);
    }
    // a trading house in the background
    p.box(0.35, 0.3, 2.9, 1.45, 30, PLASTER, undefined, false, 'timber');
    p.door(1.6, 1.45, 0.4, 16);
    p.window_l(0.8, 1.45, 17);
    p.window_l(2.4, 1.45, 17);
    p.window_r(2.9, 0.85, 17);
    p.gable(0.35, 0.3, 2.9, 1.45, 30, 22, ROOF_RED, PLASTER, 'x');
    p.banner_l(1.1, 1.45, 28, color);
    p.banner_l(2.1, 1.45, 28, color);

    const stall = (x0, y0, x1, y1, stripes = 5) => {
        // posts, a counter, a striped awning (player color / white)
        for (const [px, py] of [[x0, y0], [x1 - 0.06, y0], [x0, y1 - 0.06], [x1 - 0.06, y1 - 0.06]]) {
            p.box(px, py, px + 0.06, py + 0.06, 20, [110, 78, 48], undefined, false);
        }
        p.box(x0 + 0.05, y1 - 0.35, x1 - 0.05, y1 - 0.05, 9, WOOD, undefined, undefined, 'wood');
        for (let i = 0; i < stripes; i++) {
            const a = x0 - 0.08 + (x1 - x0 + 0.16) * i / stripes;
            const b = x0 - 0.08 + (x1 - x0 + 0.16) * (i + 1) / stripes;
            const c = i % 2 === 0 ? color : [238, 232, 218];
            p.poly([[a, y0 - 0.05, 24], [b, y0 - 0.05, 24], [b, y1 + 0.12, 17], [a, y1 + 0.12, 17]], c, false);
        }
        p.line([x0 - 0.08, y1 + 0.12, 17], [x1 + 0.08, y1 + 0.12, 17], shade(color, -70), 1);
        p.line([x1 + 0.08, y0 - 0.05, 24], [x1 + 0.08, y1 + 0.12, 17], shade(color, -70), 1);
    };

    stall(0.4, 2.0, 1.6, 2.9);
    // goods on the counter: bread/fruit
    const goods = [[215, 60, 50], [240, 200, 40], [215, 60, 50]];
    for (let i = 0; i < goods.length; i++) {
        const [x, y] = p.P(0.65 + i * 0.35, 2.7, 10);
        pygame.draw.circle(surf, goods[i], [int(x), int(y)], 3);
    }
    stall(2.3, 1.95, 3.5, 2.85);
    let [x, y] = p.P(2.7, 2.65, 10);
    pygame.draw.ellipse(surf, [165, 165, 175], [x - 4, y - 3, 9, 5]);
    [x, y] = p.P(3.1, 2.65, 10);
    pygame.draw.ellipse(surf, [150, 100, 55], [x - 5, y - 2, 10, 4]);
    // crates and barrels in the square
    p.box(2.2, 3.15, 2.55, 3.5, 10, [150, 112, 70], undefined, undefined, 'wood');
    p.box(2.6, 3.25, 2.9, 3.55, 8, [138, 102, 64], undefined, undefined, 'wood');
    p.box(2.3, 3.2, 2.5, 3.4, 7, [160, 120, 76], 10, undefined, 'wood');
    for (const [bx, by] of [[3.3, 3.3], [3.55, 3.05], [1.0, 3.45]]) {
        [x, y] = p.P(bx, by, 0);
        pygame.draw.rect(surf, [120, 80, 45], [x - 5, y - 13, 10, 13], 0, 3);
        pygame.draw.line(surf, [70, 60, 50], [x - 5, y - 10], [x + 4, y - 10], 1);
        pygame.draw.line(surf, [70, 60, 50], [x - 5, y - 4], [x + 4, y - 4], 1);
        pygame.draw.ellipse(surf, [150, 105, 62], [x - 5, y - 15, 10, 4]);
    }
    // sacks of gold
    for (let i = 0; i < 3; i++) {
        [x, y] = p.P(1.6 + i * 0.18, 3.5, 0);
        pygame.draw.circle(surf, [205, 180, 120], [int(x), int(y) - 4], 4);
        pygame.draw.circle(surf, [240, 200, 40], [int(x), int(y) - 7], 2);
    }
    p.flag(0.5, 0.45, 52, color, 20);
    p.emblem(1.6, 1.45, 38, color, 'wheel');
}


export function _trade_cart_art(surf, kind, color, x, y, face, anim, swing, k, carry_res, moving) {
    const { shadow, shade } = modules.gfx;
    const [fx, fy] = face;
    const hx = fx >= 0 ? 1 : -1;
    const bob = moving ? Math.sin(anim) * 0.8 * k : 0;

    const P = (a, b, bb = true) => [int(x + a * k), int(y + b * k + (bb ? bob : 0))];

    const lw = Math.max(1, int(2 * k));
    shadow(surf, x - 17 * k, y - 4 * k, 34 * k, 10 * k);
    const horse = [132, 92, 56];
    // a horse in front
    const LX = [6, 9, 14, 17];
    for (let i = 0; i < LX.length; i++) {
        const lx = LX[i];
        const off = moving ? Math.sin(anim + i * 1.7) * 2.5 : 0;
        pygame.draw.line(surf, shade(horse, -40), P(lx * hx, -3), P((lx + off) * hx, 2, false), lw);
    }
    pygame.draw.ellipse(surf, horse, [...P(hx > 0 ? 5 : -19, -10), int(14 * k), int(8 * k)]);
    pygame.draw.polygon(surf, horse, [P(16 * hx, -9), P(20 * hx, -15), P(23 * hx, -13), P(19 * hx, -6)]);
    pygame.draw.circle(surf, horse, P(22 * hx, -14), Math.max(2, int(2.8 * k)));
    pygame.draw.line(surf, [90, 65, 40], P(4 * hx, -6), P(10 * hx, -6), lw);
    // cart
    const body = [150, 110, 68];
    pygame.draw.rect(surf, body, [...P(-14, -12), int(19 * k), int(8 * k)]);
    pygame.draw.rect(surf, shade(body, -50), [...P(-14, -12), int(19 * k), int(8 * k)], 1);
    // a canopy in player color
    pygame.draw.ellipse(surf, color, [...P(-14, -21), int(19 * k), int(14 * k)]);
    pygame.draw.ellipse(surf, shade(color, -70), [...P(-14, -21), int(19 * k), int(14 * k)], 1);
    pygame.draw.rect(surf, body, [...P(-14, -12), int(19 * k), int(4 * k)]);
    for (const tx of [-10, -5, 0]) {
        pygame.draw.line(surf, shade(color, 40), P(tx, -20), P(tx, -13), 1);
    }
    if (carry_res) {
        for (let i = 0; i < 2; i++) {
            pygame.draw.circle(surf, [240, 200, 40], P(-11 + i * 5, -12), Math.max(2, int(2.6 * k)));
        }
    }
    for (const wx of [-11, 2]) {
        pygame.draw.circle(surf, [70, 50, 32], P(wx, -2, false), Math.max(2, int(4 * k)));
        pygame.draw.circle(surf, [130, 100, 64], P(wx, -2, false), Math.max(1, int(1.5 * k)));
    }
}


// ============================================================ buildings and units
export function _market_buttons(game, b, p) {
    const { market_buttons } = modules.economy_ui;
    return market_buttons(game, b, p);
}


export function _market_panel(game, b, x, y) {
    const { market_panel } = modules.economy_ui;
    market_panel(game, b, x, y);
}


export function _mill_buttons(game, b, p) {
    const { mill_buttons } = modules.economy_ui;
    return mill_buttons(game, b, p);
}


export function _mill_panel(game, b, x, y) {
    const { mill_panel } = modules.economy_ui;
    mill_panel(game, b, x, y);
}


export function _cart_panel(game, u, x, y) {
    const { cart_panel } = modules.economy_ui;
    cart_panel(game, u, x, y);
}


add_building('market', undefined, { size: 4, hp: 1800, cost: { wood: 175 }, time: 60, age: 1, los: 6,
    trains: ['trade_cart'], techs: [], art: _market_art, art_h: 90,
    buttons: _market_buttons, panel: _market_panel });
// the market is one of the buildings needed to advance to the Castle Age
AGE_REQ['castle'][0].add('market');

add_unit('trade_cart', { hp: 70, atk: 0, rng: 0, reload: 2.0, arm: [0, 0], speed: 1.0, los: 7,
    cost: { wood: 100, food: 50 }, time: 51, age: 1, cls: 'vil', radius: 12, civil: true,
    art: _trade_cart_art, command: market.trade_command, panel: _cart_panel,
    states: { trade: market.do_trade } });

// mill: farm reseed queue buttons
BUILDINGS['mill']['buttons'] = _mill_buttons;
BUILDINGS['mill']['panel'] = _mill_panel;

// ============================================================ techs
export const V = 'villager';

// market
add_tech('coinage', 'market', { cost: { food: 150, gold: 50 }, time: 50, age: 1, effects: [{ stat: 'tribute_fee', mul: 0 }] });
add_tech('caravan', 'market', { cost: { food: 200, gold: 200 }, time: 40, age: 2, effects: [{ stat: 'speed', kind: 'trade_cart', mul: 1.5 }] });
add_tech('guilds', 'market', { cost: { food: 300, gold: 200 }, time: 60, age: 3, effects: [{ stat: 'market_fee', mul: 0.5 }] });

// mill
add_tech('heavy_plow', 'mill', { cost: { food: 125, wood: 125 }, time: 40, age: 2, req: 'horse_collar', effects: [{ stat: 'farm_food', add: 125 }, { stat: 'carry', kind: V, src: 'farm', add: 1 }] });
add_tech('crop_rotation', 'mill', { cost: { food: 250, wood: 250 }, time: 70, age: 3, req: 'heavy_plow', effects: [{ stat: 'farm_food', add: 175 }] });

// lumber camp
add_tech('bow_saw', 'lumber_camp', { cost: { food: 150, wood: 100 }, time: 50, age: 2,
    req: 'double_bit', effects: [{ stat: 'gather', res: 'wood', mul: 1.2 }] });
add_tech('two_man_saw', 'lumber_camp', { cost: { food: 300, wood: 200 }, time: 100, age: 3,
    req: 'bow_saw', effects: [{ stat: 'gather', res: 'wood', mul: 1.1 }] });

// mining camp
add_tech('gold_shaft', 'mining_camp', { cost: { food: 200, wood: 150 }, time: 75,
    age: 2, req: 'gold_mining', effects: [{ stat: 'gather', res: 'gold', mul: 1.15 }] });
add_tech('stone_mining', 'mining_camp', { cost: { food: 100, wood: 75 }, time: 30, age: 1,
    effects: [{ stat: 'gather', res: 'stone', mul: 1.15 }] });
add_tech('stone_shaft', 'mining_camp', { cost: { food: 200, wood: 150 }, time: 75,
    age: 2, req: 'stone_mining', effects: [{ stat: 'gather', res: 'stone', mul: 1.15 }] });

// town center
add_tech('hand_cart', 'town_center', { cost: { food: 300, wood: 200 }, time: 55, age: 2,
    req: 'wheelbarrow', effects: [{ stat: 'speed', kind: V, mul: 1.1 }, { stat: 'carry', kind: V, mul: 1.4 }] });
add_tech('town_watch', 'town_center', { cost: { food: 75 }, time: 25, age: 1, effects: [{ stat: 'los', cls: 'bld', add: 4 }] });
add_tech('town_patrol', 'town_center', { cost: { food: 300, gold: 200 }, time: 40, age: 2,
    req: 'town_watch', effects: [{ stat: 'los', cls: 'bld', add: 4 }] });

// checking the existing economic techs against the original's tables
for (const [_k, _cost, _time, _age] of [['loom', { gold: 50 }, 25, 0], ['wheelbarrow', { food: 175, wood: 50 }, 75, 1],
    ['horse_collar', { food: 75, wood: 75 }, 20, 1],
    ['double_bit', { food: 100, wood: 50 }, 25, 1],
    ['gold_mining', { food: 100, wood: 75 }, 30, 1]]) {
    Object.assign(TECHS[_k], { cost: _cost, time: _time, age: _age });
}
