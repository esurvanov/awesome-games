// port of game/content/__init__.py
// Content registration: each module of this package appends its own entries to the tables in data.js.
// The helpers are hoisted `function` declarations: content modules call them while this module is still loading
// (its imports below evaluate first). Python discovers modules with pkgutil, sorted by name, skipping '_' names;
// here the imports are listed in that order (ES imports evaluate in statement order = registration order).
import { UNITS, BUILDINGS, TECHS, BUILD_MENU } from '../data.js';
import * as py from '../../runtime/py.js';

/** A new unit kind. Required fields are the same as for UNITS in data.py. */
export function add_unit(key, d = {}) {
    UNITS[key] = d;
    return d;
}

/** A new building; menu=True adds it to the villager build menu. */
export function add_building(key, menu = true, d = {}) {
    BUILDINGS[key] = d;
    if (menu && !BUILD_MENU.includes(key)) BUILD_MENU.push(key);
    return d;
}

/** A new tech; at is the building (or a tuple of buildings) where it is researched. */
export function add_tech(key, at = null, d = {}) {
    TECHS[key] = d;
    for (const b of (Array.isArray(at) ? at : at ? [at] : [])) add_techs(b, key);
    return d;
}

export function add_trains(building, ...units) {
    const lst = py.setdefault(BUILDINGS[building], 'trains', []);
    for (const u of units) {
        if (!lst.includes(u)) lst.push(u);
    }
}

export function add_techs(building, ...techs) {
    const lst = py.setdefault(BUILDINGS[building], 'techs', []);
    for (const t of techs) {
        if (!lst.includes(t)) lst.push(t);
    }
}

export function _load_all() {
    // done by the static imports below (sorted order, '_' modules skipped)
}

import './army_archers.js';
import './army_base.js';
import './army_blacksmith.js';
import './army_cavalry.js';
import './army_infantry.js';
import './army_monks.js';
import './army_siege.js';
import './army_university.js';
import './civ_units.js';
import './civs.js';
import './economy.js';
import './garrison.js';
import './man_at_arms.js';
import './naval.js';
import './relics_wolves.js';
import './towers.js';
import './walls.js';
import './zz_university_stub.js';
