// port of game/content/walls.py
// Walls and gates (numbers as in the original, Definitive Edition).
// Walls are placed by dragging a line (1x1 segments, paid per segment), gates - 4 tiles in a row,
// on free ground or over your own wall. Own and allied units pass through gates, enemies do not.
// Graphics - wallgfx.js. Logic - defense.js. University techs: Masonry, Architecture, Fortified Wall, Treadmill Crane.
import { add_building, add_tech } from './__init__.js';
import { at_university } from './_uni.js';

export const WALL = { size: 1, los: 2, wall: true };

add_building('palisade_wall', undefined, { hp: 250, cost: { wood: 2 }, time: 5, age: 0, arm: [2, 5],
    line: true, ...WALL });
add_building('palisade_gate', undefined, { hp: 400, cost: { wood: 30 }, time: 30, age: 0, arm: [2, 2],
    gate: true, span: 4, ...WALL });
add_building('stone_wall', undefined, { hp: 1800, cost: { stone: 5 }, time: 8, age: 1, arm: [8, 10],
    line: true, ...WALL });
add_building('gate', undefined, { hp: 2750, cost: { stone: 30 }, time: 70, age: 1, arm: [6, 6],
    gate: true, span: 4, ...WALL });

add_tech('masonry', null, { cost: { wood: 175, stone: 150 }, time: 50, age: 2, effects: [{ stat: 'hp', cls: 'bld', mul: 1.1 },
    { stat: 'arm_m', cls: 'bld', add: 1 },
    { stat: 'arm_p', cls: 'bld', add: 1 }] });
add_tech('architecture', null, { cost: { wood: 200, stone: 300 }, time: 70, age: 3, req: 'masonry', effects: [{ stat: 'hp', cls: 'bld', mul: 1.1 },
    { stat: 'arm_m', cls: 'bld', add: 1 },
    { stat: 'arm_p', cls: 'bld', add: 1 }] });
add_tech('fortified_wall', null, { cost: { food: 200, stone: 100 }, time: 50, age: 2, effects: [{ stat: 'hp', kind: 'stone_wall', add: 1200 },
    { stat: 'arm_m', kind: 'stone_wall', add: 4 },
    { stat: 'arm_p', kind: 'stone_wall', add: 2 }] });
add_tech('treadmill_crane', null, { cost: { wood: 300, stone: 200 }, time: 40, age: 2, effects: [{ stat: 'build', kind: 'villager', mul: 1.2 }] });

at_university('masonry', 'architecture', 'fortified_wall', 'treadmill_crane');
