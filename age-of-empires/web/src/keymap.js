// port of game/keymap.py
// Hotkeys with remapping (Settings -> "Hotkeys").
//   key_for(action, default=None) -> a pygame key code
//   matches(action, key) -> bool - the pressed key belongs to the action (taking spare keys into account).
//   translate(key) - for game input (screens.overlay_event): the assigned key -> the default key.
//   set_key(action, key) / reset() - save to settings.json ('keys': {action: key name}).
// Key names are stored as pygame.key.name() strings - the file is human-readable.
import * as py from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as i18n from './i18n.js';
import * as settings from './settings.js';

// (action, locale caption key, default key, spare keys) - order = the order in the settings list
export const ACTIONS = [
    ['menu', 'keys.menu', 'f10', []],
    ['help', 'keys.help', 'f1', []],
    ['civ', 'keys.civ', 'f2', []],
    ['pause', 'keys.pause', 'f3', ['p', 'pause']],
    ['score', 'keys.score', 'f4', []],
    ['objectives', 'keys.objectives', 'f5', []],
    ['quick_save', 'keys.quick_save', 'f7', []],
    ['quick_load', 'keys.quick_load', 'f8', []],
    ['idle_villager', 'keys.idle_villager', '.', []],
    ['idle_military', 'keys.idle_military', ',', []],
    ['town_center', 'keys.town_center', 'h', []],
    ['go_selected', 'keys.go_selected', 'space', []],
    ['delete', 'keys.delete', 'delete', []],
    ['speed_up', 'keys.speed_up', '=', ['+', '[+]']],
    ['speed_down', 'keys.speed_down', '-', ['[-]']],
    ['music', 'keys.music', 'm', []],
    ['sfx', 'keys.sfx', 'n', []],
];
export const LABEL = Object.fromEntries(ACTIONS.map(([a, lbl]) => [a, lbl]));     // locale keys; the caption is label(action)
export const DEFAULT = Object.fromEntries(ACTIONS.map(([a, , k]) => [a, k]));
export const ALT = Object.fromEntries(ACTIONS.map(([a, , , alt]) => [a, alt]));


/** The action's caption in the player's language. */
export function label(action) {
    return i18n.t(py.get(LABEL, action, action));
}


export function _code(name) {
    try {
        return pygame.key.key_code(name);
    } catch (e) {
        // (ValueError, pygame.error, AttributeError) - the runtime's key_code throws its own ValueError class
        return null;
    }
}


function _keys() {
    const k = settings.get('keys');
    return py.bool(k) ? k : {};
}


/** The name of the assigned key (a pygame string). */
export function name_for(action) {
    return py.get(_keys(), action) || py.get(DEFAULT, action, '');
}


export function key_for(action, default_ = null) {
    const kn = py.get(_keys(), action);
    if (kn) {
        const c = _code(kn);
        if (c != null) return c;
    }
    if (default_ != null) return default_;
    return Object.hasOwn(DEFAULT, action) ? _code(py.get(DEFAULT, action, '')) : null;
}


export function matches(action, key) {
    if (key === key_for(action)) return true;
    if (py.get(_keys(), action)) return false;            // remapped - the spare default keys no longer work
    return py.get(ALT, action, []).some(n => _code(n) === key);
}


export function default_code(action) {
    return _code(py.get(DEFAULT, action, ''));
}


/** Remapping for game input: the pressed key -> the default key code of its action (if the action
 * is remapped to it), 'swallow' - the default key of an action that is remapped to another key,
 * None - leave alone. This way input written for default keys obeys the settings. */
export function translate(key) {
    const keys = _keys();
    if (!py.bool(keys)) return null;
    for (const [a, kn] of Object.entries(keys)) {
        if (kn && Object.hasOwn(DEFAULT, a) && kn !== DEFAULT[a] && _code(kn) === key) return _code(DEFAULT[a]);
    }
    for (const [a, kn] of Object.entries(keys)) {
        if (kn && Object.hasOwn(DEFAULT, a) && kn !== DEFAULT[a] && (_code(DEFAULT[a]) === key ||
            py.get(ALT, a, []).some(x => _code(x) === key))) {
            return 'swallow';
        }
    }
    return null;
}


/** Assign a key (a pygame code). If the key is already taken by another action, that
 * action's keys are swapped (as in DE: no two actions on one key). */
export function set_key(action, key) {
    const keys = { ..._keys() };
    const kn = pygame.key.name(key);
    const old = name_for(action);
    for (const [a] of ACTIONS) {
        if (a !== action && name_for(a) === kn) keys[a] = old;
    }
    keys[action] = kn;
    settings.put('keys', keys);
}


export function reset() {
    settings.put('keys', {});
}


/** A key name for a caption: 'f10' -> 'F10', 'space' -> "Space" in the player's language. */
export function pretty(kn) {
    const names = { space: i18n.t('key.space'), delete: 'Delete', backspace: 'Backspace', return: 'Enter',
        escape: 'Esc', tab: 'Tab', pause: 'Pause' };
    if (Object.hasOwn(names, kn)) return names[kn];
    return [...kn].length <= 3 ? kn.toUpperCase() : py.capitalize(kn);
}
