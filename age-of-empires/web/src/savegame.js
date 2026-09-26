// port of game/savegame.py
// Saving and loading a match (F10 -> "Save" / "Load", "Single Player" -> "Load Game").
//
// The file format `home/saves/<slot>.sav` (browser storage, persisted to IndexedDB) - a header and a body:
//   1) a header (dict): name, date, civ, time, map, players, version - readable without loading the world
//      (the list of slots); written as one JSON line;
//   2) the body (after the first '\n'): pickle.js text of
//      {'world': World, 'random': the random state, 'serial': Node.serial, 'ui': {camera, speed...}}.
// Next to it lies a thumbnail `<slot>.png` (a screenshot at the moment of saving).
//
// The world is a graph of objects (units <-> buildings <-> players <-> AI <-> world); pickle saves it entirely with all
// the cross references. The static tables (UNITS, BUILDINGS, TECHS, CIVS...) that objects refer to
// (u.d, a player's effects, content functions) are not written to the file: they are replaced by an "address" in a table
// (persistent_id) and taken from the current tables on load. pygame surfaces and modules are not saved
// (replaced by None) - the drawing caches rebuild themselves.
import * as py from '../runtime/py.js';
import { random, time, os, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as pickle from '../runtime/pickle.js';
import * as storage from '../runtime/storage.js';
import * as data from './data.js';

export const SAVE_DIR = os.path.join(storage.HOME, 'saves');
export const VERSION = 1;
export const AUTOSAVE = 'autosave';

export let _REG = null;          // table object -> address  [Python: id(table object) -> address]
export const _KEEP = [];         // the objects themselves (so that ids are not reused)

export function _tables() {
    const names = ['UNITS', 'BUILDINGS', 'TECHS', 'CIVS', 'NODE_DEFS', 'ANIMALS', 'WORLD_HOOKS', 'AGE_REQ',
        'START_RES', 'RES_NAME', 'RES_COLOR', 'BUILDING_ARMOR'];
    const out = {};
    for (const n of names) if (n in data && data[n] !== undefined) out[n] = data[n];
    return out;
}

function _is_container(obj) {
    if (obj == null) return false;
    if (typeof obj === 'function') return true;
    if (typeof obj !== 'object') return false;
    return Array.isArray(obj) || obj instanceof Map || obj instanceof Set || obj instanceof py.TDict ||
        obj instanceof py.TSet || py.is_dict(obj);
}

/** All dicts/lists/functions inside the static data.py tables - with an address (table name, keys...). */
export function _registry() {
    if (_REG !== null) return _REG;
    const reg = new Map();
    const keep = [];

    const walk = (obj, path, depth) => {
        if (depth > 7) return;
        if (_is_container(obj)) {
            if (reg.has(obj)) return;
            reg.set(obj, path);
            keep.push(obj);
        }
        if (obj instanceof Map || obj instanceof py.TDict) {
            for (const [k, v] of obj.entries()) {
                if (typeof k === 'string' || typeof k === 'number' || Array.isArray(k)) walk(v, path.concat([['k', k]]), depth + 1);
            }
        } else if (Array.isArray(obj)) {
            obj.forEach((v, i) => walk(v, path.concat([['i', i]]), depth + 1));
        } else if (obj != null && typeof obj === 'object' && py.is_dict(obj)) {
            for (const k of Object.keys(obj)) walk(obj[k], path.concat([['k', k]]), depth + 1);
        }
    };

    for (const [n, t] of Object.entries(_tables())) walk(t, [n], 0);
    _REG = reg;
    _KEEP.splice(0, _KEEP.length, ...keep);
    return reg;
}

export function _resolve(path) {
    let obj = _tables()[path[0]];
    for (const [how, k] of path.slice(1)) {
        if (obj instanceof Map || obj instanceof py.TDict) obj = obj.get(k);
        else obj = obj[k];
    }
    return obj;
}

// pygame objects are not saved (Python: type(obj).__module__.startswith('pygame') -> ('N',))
const _PYGAME_TYPES = [pygame.Surface, pygame.Rect, pygame.Font, pygame.Mask, pygame.Vector2, pygame.Clock,
    pygame.Event, pygame.Sound, pygame.Channel, pygame.cursors && pygame.cursors.Cursor].filter(C => typeof C === 'function');

let _FUNCS = null;               // module-level function -> [module name, export name] (pickle stores functions by name)
function _func_index() {
    if (_FUNCS === null) {
        _FUNCS = new Map();
        for (const [mname, ns] of Object.entries(modules)) {
            for (const k of Object.keys(ns)) {
                let v;
                try { v = ns[k]; } catch (e) { continue; }
                if (typeof v === 'function' && !_FUNCS.has(v)) _FUNCS.set(v, [mname, k]);
            }
        }
    }
    return _FUNCS;
}

function _module_name(obj) {
    for (const [mname, ns] of Object.entries(modules)) if (ns === obj) return mname;
    return null;
}

/** pickle.Pickler.persistent_id */
export function _persistent_id(obj) {
    if (obj == null || typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return null;
    const p = _registry().get(obj);
    if (p !== undefined) return ['T', p];
    for (const C of _PYGAME_TYPES) if (obj instanceof C) return ['N'];      // surfaces, fonts, sounds - not saved
    if (Object.prototype.toString.call(obj) === '[object Module]') {
        const name = _module_name(obj);
        return name != null ? ['M', name] : ['N'];
    }
    if (typeof obj === 'function') {
        // a registered class is pickled by name (py.register_class); a module-level function - by (module, name);
        // lambdas / closures - None
        const f = _func_index().get(obj);
        if (f !== undefined) return ['F', f[0], f[1]];
        return ['N'];
    }
    return null;
}

/** pickle.Unpickler.persistent_load */
export function _persistent_load(pid) {
    if (pid[0] === 'T') return _resolve(pid[1]);
    if (pid[0] === 'M') {
        const m = modules[pid[1]];
        return m === undefined ? null : m;
    }
    if (pid[0] === 'F') {
        const m = modules[pid[1]];
        return m === undefined || m[pid[2]] === undefined ? null : m[pid[2]];
    }
    return null;
}

export function dumps(obj) {
    return pickle.dumps(obj, { persistent_id: _persistent_id });
}

export function loads(b) {
    return pickle.loads(b, { persistent_load: _persistent_load });
}

// ============================================================ slots
export function slot_path(slot, ext = '.sav') {
    let safe = '';
    for (const c of Array.from(py.str(slot))) safe += (py.isalnum(c) || '-_'.includes(c)) ? c : '_';
    safe = Array.from(safe).slice(0, 40).join('') || 'save';
    return os.path.join(SAVE_DIR, safe + ext);
}

export function meta_of(world, name) {
    const { civ_name } = modules.civ_ui;
    const p = world.players[world.human];
    return {
        'name': name, 'date': time.strftime('%Y-%m-%d %H:%M'), 'stamp': time.time(),
        'civ': p.civ, 'civ_name': civ_name(p.civ), 'time': world.time, 'map': world.map_type,
        'players': world.players.length, 'size': world.W, 'version': VERSION,
    };
}

/** Write a match to a slot. ui - a dict of the interface state (camera, speed...);
 *  thumb - a pygame.Surface for the thumbnail. Returns the file path. */
export function save_world(world, slot, name = null, ui = null, thumb = null) {
    const { Node } = modules.world;
    storage.makedirs(SAVE_DIR);
    const body = { 'world': world, 'random': random.getstate(), 'serial': Node.serial, 'ui': py.bool(ui) ? ui : {} };
    const blob = dumps(body);
    const path = slot_path(slot);
    const tmp = path + '.tmp';
    storage.write_text(tmp, JSON.stringify(meta_of(world, name || py.str(slot))) + '\n' + blob);
    storage.replace(tmp, path);
    if (thumb != null) {
        try {
            const sm = pygame.transform.smoothscale(thumb, [240, 150]);
            pygame.image.save(sm, slot_path(slot, '.png'));
        } catch (e) {
            // pass
        }
    }
    return path;
}

function _split(text) {
    const i = text.indexOf('\n');
    return i < 0 ? [text, ''] : [text.slice(0, i), text.slice(i + 1)];
}

/** (world, ui dict, header). Also restores the random state. */
export function load_world(slot) {
    const { Node } = modules.world;
    const [head, rest] = _split(storage.read_text(slot_path(slot)));
    const meta = JSON.parse(head);
    const body = loads(rest);
    random.setstate(body['random']);
    Node.serial = Math.max(Node.serial, py.get(body, 'serial', 0));
    const w = body['world'];
    return [w, py.get(body, 'ui', {}), meta];
}

/** [(slot, header, thumbnail path or None)] - newest on top. */
export function list_slots() {
    const out = [];
    let names;
    try {
        names = storage.listdir(SAVE_DIR);
    } catch (e) {
        if (!(e instanceof py.OSError) && !(e instanceof py.FileNotFoundError)) throw e;
        return out;
    }
    for (const fn of names) {
        if (!fn.endsWith('.sav')) continue;
        const slot = fn.slice(0, -4);
        let meta;
        try {
            meta = JSON.parse(_split(storage.read_text(os.path.join(SAVE_DIR, fn)))[0]);
        } catch (e) {
            continue;
        }
        const th = slot_path(slot, '.png');
        out.push([slot, meta, storage.exists(th) ? th : null]);
    }
    py.sort(out, s => -py.get(s[1], 'stamp', 0));
    return out;
}

export function delete_slot(slot) {
    for (const ext of ['.sav', '.png']) {
        try {
            storage.remove(slot_path(slot, ext));
        } catch (e) {
            if (!(e instanceof py.OSError) && !(e instanceof py.FileNotFoundError)) throw e;
        }
    }
}

export function new_slot_name() {
    return time.strftime('save_%Y%m%d_%H%M%S');
}
