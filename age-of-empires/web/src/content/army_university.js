// port of game/content/army_university.py
// University (Castle Age) and its military techs: Ballistics, Chemistry, Siege Engineers.
// Other modules add their techs here: add_techs('university', ...) or add_tech(..., at='university').
import { add_building, add_tech } from './__init__.js';
import * as art from './_army_art.js';

add_building('university', undefined, { size: 4, hp: 2100, cost: { wood: 200 }, time: 60, age: 2, los: 6,
    art: art.university, art_h: 110 });

add_tech('ballistics', 'university', { cost: { wood: 300, gold: 175 }, time: 60, age: 2,
    effects: [{ stat: 'lead', add: 1 }] });
add_tech('chemistry', 'university', { cost: { food: 300, gold: 200 }, time: 100, age: 3, effects: [{ stat: 'atk', cls: ['arch', 'siege', 'bld'], not_cls: ['gunpowder', 'ram'], add: 1 }] });
add_tech('siege_engineers', 'university', { cost: { food: 500, wood: 600 }, time: 45,
    age: 3, effects: [{ stat: 'rng', kind: ['mangonel', 'onager', 'siege_onager', 'scorpion', 'heavy_scorpion',
        'bombard_cannon'], add: 1 },
    { stat: 'bonus:bld', cls: 'siege', mul: 1.2 }] });
