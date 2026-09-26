// port of game/map_assets.py
/* Landscape graphics of the maps (assets/gen/maps/, index maps.json - tools/build_map_assets.py).

Loaded lazily; no files - the functions return None and the game draws its former look (the sprites3d atlas).
  tile_fn(w)            - a function "terrain type name -> tile" for terrain_gfx.load_tiles taking the landscape into account
  tree(w, tx, ty, var)  - (surface, ox, oy) of a landscape tree; None - let sprites3d.tree draw it
  animal(kind, var, face) - (surface, ox, oy) of an animal missing from the atlas (the wolf)
  relic()               - (surface, ox, oy) of a relic; (ox, oy) is the top corner of the tile's diamond
*/
import * as py from '../runtime/py.js';
import { math, os } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as themes from './themes.js';
import * as sprites3d from './sprites3d.js';

export const GEN = 'assets/gen';
export let _idx = null;
export let _tried = false;
export const _img = new Map();
export const _spr = new Map();
export const _tiles = new Map();
// the foliage of own species is already brought to the DE green at build time (tools/build_map_assets.py LEAF_TONE);
// the atlas species (oak, pine...) in a foreign landscape - as in sprites3d.tree (_greener)
export const _GREEN = [];


export function index() {
    if (!_tried) {
        _tried = true;
        if (os.environ.NO_SPRITES3D) return null;
        try {
            _idx = assets.read_json(os.path.join(GEN, 'maps', 'maps.json'));
        } catch (e) {
            _idx = null;
        }
    }
    return _idx;
}


export function _load(rel, alpha = true) {
    let s = _img.get(rel);
    if (s == null) {
        s = pygame.image.load(os.path.join(GEN, rel));
        if (pygame.display.get_surface() != null)
            s = alpha ? s.convert_alpha() : s.convert();
        _img.set(rel, s);
    }
    return s;
}


export function _sprite(rec, green = false) {
    const key = rec['file'] + '|' + (green ? 1 : 0);
    let hit = _spr.get(key);
    if (hit == null) {
        let s = _load(rec['file']);
        if (green) s = sprites3d._greener(s);
        hit = [s, rec['ox'], rec['oy']];
        _spr.set(key, hit);
    }
    return hit;
}


// ------------------------------------------------------------------ ground
export function terrain_tile(name) {
    const ix = index();
    const rec = ix && py.get(py.get(ix, 'terrain', {}), name);
    if (!py.bool(rec)) return null;
    let t = _tiles.get(name);
    if (t == null) {
        t = _load(rec['file'], false);
        _tiles.set(name, t);
    }
    return t;
}


/** For terrain_gfx.load_tiles: terrain type -> a landscape tile (none - the atlas tile). */
export function tile_fn(w) {
    const tex = themes.of(w)['tex'];

    const fn = (name) => {
        const alias = py.get(tex, name);
        if (alias) {
            const t = terrain_tile(alias) || sprites3d.terrain_tile(alias);
            if (t != null) return t;
        }
        return sprites3d.terrain_tile(name);
    };
    return fn;
}


// ------------------------------------------------------------------ trees
/** A tree of the match's landscape; None - the default landscape or no sprites (sprites3d.tree draws it). */
export function tree(w, tx, ty, _var) {
    if (themes.key_of(w) === themes.DEFAULT) return null;
    const ix = index() || {};
    const own = py.get(ix, 'trees', {});
    const base = sprites3d._nat_list('trees') || {};
    const avail = new Set();
    for (const n of Object.keys(own)) if (py.bool(own[n])) avail.add(n);
    for (const n of Object.keys(base)) if (py.bool(base[n])) avail.add(n);
    const sp = themes.tree_species(w, tx, ty, avail);
    if (sp == null) return null;
    if (py.bool(py.get(own, sp))) {
        const lst = own[sp];
        return _sprite(lst[py.mod(sprites3d._hash(tx, ty, 3) + _var, lst.length)], _GREEN.includes(sp));
    }
    const lst = base[sp];
    const rec = lst[py.mod(sprites3d._hash(tx, ty, 3) + _var, lst.length)];
    return _sprite(rec, true);
}


// ------------------------------------------------------------------ animals and relic
export function animal(kind, _var, face) {
    const ix = index();
    const vs = ix && py.get(py.get(ix, 'animals', {}), kind);
    if (!py.bool(vs)) return null;
    const dirs = vs[py.mod(_var, vs.length)];
    const d = py.mod(py.round(math.atan2(face[1], face[0]) / (Math.PI / 4)), 8);
    return _sprite(dirs[d % dirs.length]);
}


export function relic() {
    const ix = index();
    const rec = ix && py.get(ix, 'relic');
    if (!py.bool(rec)) return null;
    return _sprite(rec);
}
