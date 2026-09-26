// port of game/content/_uni.py
// University techs from the defense modules.
//
// Another module (or the zz_university_stub.js stub if there is none) may register the University:
// at_university() adds the techs at once if the building already exists, and in any case remembers them -
// zz_university_stub.js (loaded last) attaches the remembered ones once more (add_techs does not duplicate).
import { BUILDINGS } from '../data.js';
import { add_techs } from './__init__.js';

export const PENDING = [];

export function at_university(...techs) {
    if (Object.hasOwn(BUILDINGS, 'university')) {
        add_techs('university', ...techs);
    }
    for (const t of techs) PENDING.push(t);
}
