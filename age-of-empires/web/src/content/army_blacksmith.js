// port of game/content/army_blacksmith.py
// Blacksmith - the full set: infantry/cavalry attack, archer attack (and tower/center/castle), infantry,
// cavalry and archer armor. Costs, times, ages and chains (req) are as in DE.
import { add_tech } from './__init__.js';
import { BUILDINGS } from '../data.js';

export const MELEE = { cls: ['inf', 'cav'], not_cls: ['arch'] };      // infantry and cavalry (without cavalry archers)
export const ARCH = { cls: 'arch', not_cls: ['gunpowder'] };          // archers, skirmishers, cavalry archers
export const INF = { cls: 'inf' };
export const CAV = { cls: 'cav', not_cls: ['arch'] };
export const ARCH_ARMOR = { cls: 'arch' };


export function _atk(f, n) {
    return [{ ...f, stat: 'atk', add: n }];
}

export function _arm(f, m, p) {
    return [{ ...f, stat: 'arm_m', add: m }, { ...f, stat: 'arm_p', add: p }];
}

export function _arrows(n) {
    // arrows of archers, as well as of the town center, towers and castle: +1 attack, +1 range
    return [{ ...ARCH, stat: 'atk', add: n }, { ...ARCH, stat: 'rng', add: 1 },
        { stat: 'atk', cls: 'bld', add: n }, { stat: 'rng', cls: 'bld', add: 1 }];
}


export const T = { at: 'blacksmith' };
// melee attack
add_tech('forging', T.at, { cost: { food: 150 }, time: 50, age: 1, effects: _atk(MELEE, 1) });
add_tech('iron_casting', T.at, { cost: { food: 220, gold: 120 }, time: 75, age: 2, req: 'forging', effects: _atk(MELEE, 1) });
add_tech('blast_furnace', T.at, { cost: { food: 275, gold: 225 }, time: 100, age: 3, req: 'iron_casting', effects: _atk(MELEE, 2) });
// arrows
add_tech('fletching', T.at, { cost: { food: 100, gold: 50 }, time: 30, age: 1, effects: _arrows(1) });
add_tech('bodkin_arrow', T.at, { cost: { food: 200, gold: 100 }, time: 35, age: 2, req: 'fletching', effects: _arrows(1) });
add_tech('bracer', T.at, { cost: { food: 300, gold: 200 }, time: 40, age: 3, req: 'bodkin_arrow', effects: _arrows(1) });
// infantry armor
add_tech('scale_armor', T.at, { cost: { food: 100 }, time: 40, age: 1, effects: _arm(INF, 1, 1) });
add_tech('chain_mail', T.at, { cost: { food: 200, gold: 100 }, time: 55, age: 2, req: 'scale_armor', effects: _arm(INF, 1, 1) });
add_tech('plate_mail', T.at, { cost: { food: 300, gold: 150 }, time: 70, age: 3, req: 'chain_mail', effects: _arm(INF, 1, 2) });
// cavalry armor
add_tech('scale_barding', T.at, { cost: { food: 150 }, time: 45, age: 1, effects: _arm(CAV, 1, 1) });
add_tech('chain_barding', T.at, { cost: { food: 250, gold: 150 }, time: 60, age: 2, req: 'scale_barding', effects: _arm(CAV, 1, 1) });
add_tech('plate_barding', T.at, { cost: { food: 350, gold: 200 }, time: 75, age: 3, req: 'chain_barding', effects: _arm(CAV, 1, 2) });
// archer armor
add_tech('padded_archer_armor', T.at, { cost: { food: 100 }, time: 40, age: 1, effects: _arm(ARCH_ARMOR, 1, 1) });
add_tech('leather_archer_armor', T.at, { cost: { food: 150, gold: 150 }, time: 55, age: 2,
    req: 'padded_archer_armor', effects: _arm(ARCH_ARMOR, 1, 1) });
add_tech('ring_archer_armor', T.at, { cost: { food: 250, gold: 250 }, time: 70, age: 3, req: 'leather_archer_armor', effects: _arm(ARCH_ARMOR, 1, 2) });

// button order in the blacksmith: by rows (attack, arrows, infantry, cavalry, archer armor)
export const _ORDER = ['forging', 'iron_casting', 'blast_furnace', 'fletching', 'bodkin_arrow',
    'bracer', 'scale_armor', 'chain_mail', 'plate_mail', 'scale_barding',
    'chain_barding', 'plate_barding', 'padded_archer_armor', 'leather_archer_armor', 'ring_archer_armor'];
BUILDINGS['blacksmith']['techs'] = [..._ORDER, ...BUILDINGS['blacksmith']['techs'].filter(t => !_ORDER.includes(t))];
