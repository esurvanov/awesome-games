// port of game/content/army_infantry.py
// Barracks infantry: the militia line (after Man-at-Arms), the spearman line, barracks techs. Values are DE.
import { add_unit, add_tech } from './__init__.js';
import * as art from './_army_art.js';
import { UNITS } from '../data.js';

export const MILITIA_LINE = ['militia', 'man_at_arms', 'long_swordsman', 'two_handed_swordsman', 'champion'];

// foot(helmet, weapon, shield, plate, plume, cape)
UNITS['militia']['art'] = art.foot('iron', 'sword');

// ---- militia line (Man-at-Arms is in man_at_arms.js)
add_unit('long_swordsman', { hp: 60, atk: 9, rng: 0, reload: 2.0, arm: [0, 1], speed: 0.9, los: 4,
    cost: { food: 60, gold: 20 }, time: 21, age: 2, cls: 'inf', radius: 8, line: 'militia',
    art: art.foot('sallet', 'longsword', true) });
add_tech('long_swordsman', 'barracks', { cost: { food: 150, gold: 65 }, time: 45, age: 2,
    req: 'man_at_arms', upgrade: ['man_at_arms', 'long_swordsman'] });

add_unit('two_handed_swordsman', { hp: 60, atk: 12, rng: 0, reload: 2.0, arm: [0, 1], speed: 0.9, los: 5,
    cost: { food: 60, gold: 20 }, time: 21, age: 3, cls: 'inf', radius: 8, line: 'militia',
    art: art.foot('great', 'greatsword') });
add_tech('two_handed_swordsman', 'barracks', { cost: { food: 300, gold: 100 }, time: 75, age: 3,
    req: 'long_swordsman', upgrade: ['long_swordsman', 'two_handed_swordsman'] });

add_unit('champion', { hp: 70, atk: 13, rng: 0, reload: 2.0, arm: [1, 1], speed: 0.9, los: 5,
    cost: { food: 60, gold: 20 }, time: 21, age: 3, cls: 'inf', radius: 8, line: 'militia',
    art: art.foot('great', 'greatsword', undefined, true, true, true) });
add_tech('champion', 'barracks', { cost: { food: 750, gold: 350 }, time: 100, age: 3,
    req: 'two_handed_swordsman', upgrade: ['two_handed_swordsman', 'champion'] });

// ---- spearman line
UNITS['spearman']['art'] = art.foot('iron', 'spear');
add_unit('pikeman', { hp: 55, atk: 4, rng: 0, reload: 3.0, arm: [0, 0], speed: 1.0, los: 4,
    cost: { food: 35, wood: 25 }, time: 22, age: 2, cls: 'inf', ac: ['spear'], bonus: { cav: 22 }, radius: 8,
    line: 'spearman', art: art.foot('kettle', 'pike') });
add_tech('pikeman', 'barracks', { cost: { food: 215, gold: 90 }, time: 45, age: 2,
    upgrade: ['spearman', 'pikeman'] });

add_unit('halberdier', { hp: 60, atk: 6, rng: 0, reload: 3.0, arm: [1, 0], speed: 1.0, los: 4,
    cost: { food: 35, wood: 25 }, time: 22, age: 3, cls: 'inf', ac: ['spear'], bonus: { cav: 32 }, radius: 8,
    line: 'spearman', art: art.foot('sallet', 'halberd', undefined, true) });
add_tech('halberdier', 'barracks', { cost: { food: 300, gold: 600 }, time: 50, age: 3,
    req: 'pikeman', upgrade: ['pikeman', 'halberdier'] });

// ---- barracks techs
add_tech('supplies', 'barracks', { cost: { food: 150, gold: 100 }, time: 35, age: 1, effects: [{ stat: 'cost', kind: MILITIA_LINE, res: 'food', add: -15 }] });
add_tech('squires', 'barracks', { cost: { food: 200 }, time: 40, age: 2, effects: [{ stat: 'speed', cls: 'inf', mul: 1.1 }] });
add_tech('arson', 'barracks', { cost: { food: 150, gold: 50 }, time: 25, age: 2, effects: [{ stat: 'bonus:bld', cls: 'inf', add: 2 }] });
