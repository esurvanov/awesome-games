// port of game/content/army_archers.py
// Archery range: archers, skirmishers, cavalry archers, hand cannoneer; Thumb Ring, Parthian Tactics.
import { add_unit, add_tech, add_trains } from './__init__.js';
import * as art from './_army_art.js';
import { UNITS } from '../data.js';

UNITS['archer']['art'] = art.foot('hood', 'bow');
UNITS['skirmisher']['art'] = art.foot('hood', 'javelin');

// ---- archer line
add_unit('crossbowman', { hp: 35, atk: 5, rng: 5, reload: 2.0, arm: [0, 0], speed: 0.96, los: 7,
    cost: { wood: 25, gold: 45 }, time: 27, age: 2, cls: 'arch', ac: ['foot_arch'], bonus: { spear: 3 }, acc: 0.85,
    radius: 7, line: 'archer', shot: 'bolt', art: art.foot('cap', 'crossbow') });
add_tech('crossbowman', 'archery_range', { cost: { food: 125, gold: 75 }, time: 35, age: 2,
    upgrade: ['archer', 'crossbowman'] });

add_unit('arbalester', { hp: 40, atk: 6, rng: 5, reload: 2.0, arm: [0, 0], speed: 0.96, los: 7,
    cost: { wood: 25, gold: 45 }, time: 27, age: 3, cls: 'arch', ac: ['foot_arch'], bonus: { spear: 3 }, acc: 0.9,
    radius: 7, line: 'archer', shot: 'bolt', art: art.foot('sallet', 'crossbow', undefined, true) });
add_tech('arbalester', 'archery_range', { cost: { food: 350, gold: 300 }, time: 50, age: 3,
    req: 'crossbowman', upgrade: ['crossbowman', 'arbalester'] });

// ---- skirmishers
add_unit('elite_skirmisher', { hp: 35, atk: 3, rng: 5, reload: 3.0, arm: [0, 4], speed: 0.96,
    los: 8, cost: { food: 25, wood: 35 }, time: 22, age: 2, cls: 'arch', ac: ['skirm', 'foot_arch'],
    bonus: { arch: 4, spear: 3 }, acc: 0.9, shot: 'javelin', radius: 7, line: 'skirmisher',
    art: art.foot('iron', 'javelin', true) });
add_tech('elite_skirmisher', 'archery_range', { cost: { wood: 230, gold: 130 },
    time: 50, age: 2, upgrade: ['skirmisher', 'elite_skirmisher'] });

// ---- cavalry archers
add_unit('cavalry_archer', { hp: 50, atk: 6, rng: 4, reload: 2.0, arm: [0, 0], speed: 1.4, los: 5,
    cost: { wood: 40, gold: 70 }, time: 34, age: 2, cls: 'cav', ac: ['arch', 'cav_arch'], bonus: { spear: 2 },
    acc: 0.5, radius: 11, line: 'cavalry_archer', art: art.rider([150, 110, 70], undefined, 'cap', 'bow') });
add_tech('heavy_cavalry_archer', 'archery_range', { cost: { food: 900, gold: 500 },
    time: 50, age: 3, upgrade: ['cavalry_archer', 'heavy_cavalry_archer'] });
add_unit('heavy_cavalry_archer', { hp: 60, atk: 7, rng: 4, reload: 2.0, arm: [1, 0],
    speed: 1.4, los: 6, cost: { wood: 40, gold: 70 }, time: 27, age: 3, cls: 'cav', ac: ['arch', 'cav_arch'],
    bonus: { spear: 2 }, acc: 0.5, radius: 11, line: 'cavalry_archer', art: art.rider([95, 72, 55], 'cloth', 'helm', 'bow') });

// ---- hand cannoneer (Imperial Age, needs Chemistry)
add_unit('hand_cannoneer', { hp: 40, atk: 17, rng: 7, reload: 3.45, arm: [1, 0], speed: 0.96, los: 9,
    cost: { food: 45, gold: 50 }, time: 34, age: 3, req: 'chemistry', cls: 'arch', ac: ['gunpowder'],
    bonus: { inf: 10, spear: 1, ram: 2 }, acc: 0.75, shot: 'ball', shot_speed: 420, radius: 7,
    art: art.foot('brim', 'handcannon') });

add_trains('archery_range', 'cavalry_archer', 'hand_cannoneer');

// ---- archery range techs
add_tech('thumb_ring', 'archery_range', { cost: { food: 300, wood: 250 }, time: 45, age: 2,
    effects: [{ stat: 'acc', cls: 'arch', not_cls: ['gunpowder'], add: 1 },
        { stat: 'reload', cls: 'arch', not_cls: ['gunpowder'], mul: 1 / 1.18 }] });
add_tech('parthian_tactics', 'archery_range', { cost: { food: 200, gold: 250 },
    time: 65, age: 3, effects: [{ stat: 'arm_m', cls: 'cav_arch', add: 1 },
        { stat: 'arm_p', cls: 'cav_arch', add: 2 },
        { stat: 'bonus:spear', cls: 'cav_arch', add: 4 }] });
