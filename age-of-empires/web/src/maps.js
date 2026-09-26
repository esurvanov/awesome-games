// port of game/maps.py
// The match's maps - the list and properties (no pygame and no world import: the module is read by terrain, naval,
// the lobby). Maps by the rules of AoE II DE random maps (own names):
//   arabia, arena, black_forest, nomad, islands, mediterranean; the old types 'land' and 'coast' remain for tests
//   and old saves. Generation - mapgen.js (new maps) and World.gen_map (old types).
import * as py from '../runtime/py.js';

export const MAPS = {
    // key: there is water (navy, naval AI), the start has no center; the name and description come from the locale (map.<key>.*)
    arabia: { water: false },
    arena: { water: false },
    black_forest: { water: false },
    nomad: { water: true, nomad: true },
    islands: { water: true },
    mediterranean: { water: true },
    // the former types
    land: { water: false, legacy: true },
    coast: { water: true, legacy: true },
};
// 'land' / 'coast' without a lobby (tests); int keys -> Map
export const LEGACY_SIZES = new Map([[2, 96], [3, 110], [4, 120], [5, 136], [6, 136], [7, 152], [8, 152]]);
export const LOBBY = ['arabia', 'arena', 'black_forest', 'nomad', 'islands', 'mediterranean'];
export const ALL = Object.keys(MAPS);
export const DEFAULT = 'arabia';
export const NAMES = Object.fromEntries(Object.keys(MAPS).map(k => [k, k]));   // filled in by i18n.relabel()


/** Whether the map has a sea (the naval part of the AI, docks, fish). */
export function is_water(mt) {
    return py.get(MAPS, mt, MAPS['land'])['water'];
}


export function is_legacy(mt) {
    return py.get(py.get(MAPS, mt, {}), 'legacy', false) || !Object.hasOwn(MAPS, mt);
}


export function is_nomad(mt) {
    return py.get(py.get(MAPS, mt, {}), 'nomad', false);
}


export function name(mt) {
    return py.get(NAMES, mt, mt);
}


// map names in the player's language (and on language change). Python: `from . import i18n; i18n.relabel()` at the
// bottom; i18n.relabel finds this module through sys.modules -> here py.modules (registered right before the call).
import * as _i18n from './i18n.js';
import * as _self from './maps.js';
py.register_modules({ maps: _self });
_i18n.relabel();
