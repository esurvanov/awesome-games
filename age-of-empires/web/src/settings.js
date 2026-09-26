// port of game/settings.py
// Game settings (the "Settings" screen, 5 tabs) - one file <storage HOME>/settings.json (IndexedDB-backed storage).
//
// The same file is written by the sound (sound.js: music, sfx, music_vol, sfx_vol, voice_vol) - saving always
// writes over the keys already there, other keys are not lost.
//
// API:
//   get(key, default=None)  - the value (from the file or DEFAULTS)
//   put(key, value)         - write and save
//   data()                  - the whole dict (live; after editing - save())
// Keys: see DEFAULTS. The interface (hud.js) reads 'show_hotkeys'; keys - keymap.js ('keys').
import * as py from '../runtime/py.js';
import * as storage from '../runtime/storage.js';

// KHRONIKI_HOME (~/.cache/khroniki) -> the storage prefix
export const HOME = storage.HOME;
export const PATH = py.os.path.join(HOME, 'settings.json');

export const DEFAULTS = {
    // Game
    language: null,             // language code (i18n.js LANGS); None - detect by the browser languages
    game_speed: 1.7,            // the default speed of a new match (1.0 / 1.5 / 1.7 / 2.0)
    scroll_speed: 1.0,          // camera scroll speed multiplier (0.5-2.0)
    edge_scroll: true,          // scrolling by the screen edge
    wheel_zoom: true,           // mouse wheel - zoom (DE); off - the wheel moves the map
    autosave: 0,                // minutes between autosaves (0 - off)
    // Graphics
    fullscreen: false,
    fps_limit: 60,
    live_menu_bg: true,         // menu background - a snapshot of a real town
    // Interface
    show_hotkeys: false,        // hotkey letters on the panel buttons (hud.js: hud_opt)
    show_score: true,           // player score above the minimap (F4)
    global_queue: true,         // the global production queue (a panel above the commands)
    tooltip_scale: 100,         // tooltip size, %
    cursor_soft: null,          // software cursor (crisp on Retina): None - auto (Retina -> on)
    hp_bars: 'selected',        // health bars: 'selected' | 'always'
    team_colors: false,         // "own / ally / enemy" colors instead of the players' colors
    player_name: '',            // empty - "Player" in the player's language (i18n.player_name())
    // Sound (the main keys are driven by sound.js)
    voice_vol: 0.8,
    // Hotkeys: action -> a pygame key name (see keymap.ACTIONS)
    keys: {},
    // the last lobby setup
    lobby: null,
};

export let _data = null;
// browser: another tab rewrote settings.json -> reload (keeping this tab's unsaved put() keys is moot: put() saves at once)
if (storage.on_change) storage.on_change(p => { if (_data !== null && py.os.path.normpath(p) === py.os.path.normpath(PATH)) _load(); });
export const _dirty = new Set();    // keys changed through put() (only they are written over the file)

function _is_load_error(e) {
    return e instanceof py.OSError || e instanceof SyntaxError;     // (OSError, ValueError) of json.load
}

export function _load() {
    let d = {};
    try {
        const raw = JSON.parse(storage.read_text(PATH));
        if (py.is_dict(raw)) d = raw;
    } catch (e) {
        if (!_is_load_error(e)) throw e;
    }
    _data = d;
    return d;
}


export function data() {
    return _data !== null ? _data : _load();
}


export function reload() {
    return _load();
}


export function get(key, default_ = null) {
    const d = data();
    if (Object.hasOwn(d, key)) return d[key];
    if (default_ != null) return default_;
    const v = Object.hasOwn(DEFAULTS, key) ? DEFAULTS[key] : null;
    return py.is_dict(v) ? { ...v } : v;
}


export function put(key, value) {
    data()[key] = value;
    _dirty.add(key);
    save();
}


/** Write over the file, keeping the keys that others write (sound). */
export function save() {
    try {
        let cur = {};
        try {
            cur = JSON.parse(storage.read_text(PATH));
            if (!py.is_dict(cur)) cur = {};
        } catch (e) {
            if (!_is_load_error(e)) throw e;
            cur = {};
        }
        const d = data();
        for (const k of _dirty) {
            if (Object.hasOwn(d, k)) cur[k] = d[k];
        }
        Object.assign(d, cur);
        storage.makedirs(py.os.path.dirname(PATH));
        const tmp = PATH + '.tmp';
        storage.write_text(tmp, JSON.stringify(cur));
        storage.replace(tmp, PATH);
    } catch (e) {
        if (!(e instanceof py.OSError)) throw e;
    }
}
