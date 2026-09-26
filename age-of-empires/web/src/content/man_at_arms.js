// port of game/content/man_at_arms.py
// The militia line: Man-at-Arms (Feudal Age) is the model of an upgrade line.
import { add_unit, add_tech } from './__init__.js';

add_unit('man_at_arms', { hp: 45, atk: 6, rng: 0, reload: 2.0, arm: [0, 1], speed: 0.9, los: 4,
    cost: { food: 60, gold: 20 }, time: 21, age: 1, cls: 'inf', radius: 8, line: 'militia',
    art: { helmet: 'crest', weapon: 'longsword', shield: true } });

add_tech('man_at_arms', 'barracks', { cost: { food: 100, gold: 40 }, time: 40, age: 1,
    upgrade: ['militia', 'man_at_arms'] });
