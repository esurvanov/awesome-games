// port of game/content/zz_university_stub.py
// University stub: registers only if the real university does not exist yet.
// Then it attaches the defense techs to the university (see _uni.js) - this is needed in both cases.
import { add_building, add_techs } from './__init__.js';
import { PENDING } from './_uni.js';
import { BUILDINGS } from '../data.js';

if (!Object.hasOwn(BUILDINGS, 'university')) {
    add_building('university', undefined, { size: 3, hp: 2100, cost: { wood: 200 }, time: 60, age: 2,
        los: 6, techs: [] });
}
add_techs('university', ...PENDING);
