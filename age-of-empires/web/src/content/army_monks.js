// port of game/content/army_monks.py
// Monastery and monk: heals allies, converts enemies (4-10 s at range 9, then 62 s to restore faith).
import { add_unit, add_building, add_tech } from './__init__.js';
import * as art from './_army_art.js';

add_building('monastery', undefined, { size: 3, hp: 2100, cost: { wood: 175 }, time: 40, age: 2, los: 6,
    trains: ['monk'], art: art.monastery, art_h: 100 });

add_unit('monk', { hp: 30, atk: 0, rng: 9, reload: 1.0, arm: [0, 0], speed: 0.7, los: 11,
    cost: { gold: 100 }, time: 51, age: 2, cls: 'monk', monk: true, radius: 7, unconvertible: false,
    art: art.monk });

export const MONK = { kind: 'monk' };
add_tech('sanctity', 'monastery', { cost: { gold: 120 }, time: 60, age: 2, effects: [{ ...MONK, stat: 'hp', add: 15 }] });
add_tech('fervor', 'monastery', { cost: { gold: 140 }, time: 50, age: 2, effects: [{ ...MONK, stat: 'speed', mul: 1.15 }] });
add_tech('atonement', 'monastery', { cost: { gold: 325 }, time: 40, age: 2, effects: [{ ...MONK, stat: 'convert_monk', add: 1 }] });
add_tech('redemption', 'monastery', { cost: { gold: 475 }, time: 50, age: 2, effects: [{ ...MONK, stat: 'convert_siege', add: 1 }] });
add_tech('block_printing', 'monastery', { cost: { gold: 200 }, time: 55, age: 3, effects: [{ ...MONK, stat: 'rng', add: 3 }] });
add_tech('illumination', 'monastery', { cost: { gold: 120 }, time: 65, age: 3, effects: [{ ...MONK, stat: 'faith', mul: 1.5 }] });
