// port of game/i18n.py
// Localization: all game texts come from assets/locale/<code>.json (flat keys like 'unit.knight.name').
//
//   t(key, fmt={})       - a string in the current language; no key - English, not there either - the key itself.
//                          Substitutions are {n}, {name}... via str.format (?KHRONIKI_LANG=xx - forced language).
//   set_language(code)   - switch the language: rewrite the names in the data.js tables (relabel), reset fonts
//                          and subscriber caches (on_change), remember it in settings.json ('language').
//   available()          - [[code, name in its own language]] - the list for the settings.
//   current()            - the current language code; is_cjk() - a font with ideographs is needed (zh-CN, ja).
//   name_of(kind, key)   - a table entry's name: name_of('unit', 'knight'); desc_of - the description.
//   player_name()        - the human's name from the settings or "Player" in the current language.
// The language at the first launch - by the browser languages (navigator.languages), the nearest of LANGS.
//
// The data.js tables (UNITS, BUILDINGS, TECHS, CIVS, ANIMALS, NODE_DEFS, RES_NAME, AGE_NAMES, COLOR_NAMES...) and
// maps.MAPS keep only keys in code; the 'name' / 'desc' / 'icon' fields in them are filled in by relabel() from the
// locale - at load and on every language change.
import * as py from '../runtime/py.js';
import { modules } from '../runtime/py.js';
import * as assets from '../runtime/assets.js';
import * as settings from './settings.js';
import * as data from './data.js';

export const DIR = 'assets/locale';
export const LANGS = [['en', 'English'], ['ru', 'Русский'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'],
    ['pt-BR', 'Português (Brasil)'], ['it', 'Italiano'], ['pl', 'Polski'], ['tr', 'Türkçe'],
    ['zh-CN', '简体中文'], ['ja', '日本語']];
export const CODES = LANGS.map(([c]) => c);
export const CJK = ['zh-CN', 'ja'];
export const DEFAULT = 'en';
export const COLOR_KEYS = ['blue', 'red', 'green', 'yellow', 'cyan', 'purple', 'grey', 'orange'];

// language tables: Map<key, string> (a Map: locale keys are arbitrary strings)
export const _tables = new Map();
export let _lang = null;
export let _cur = new Map();
export let _en = new Map();
export const _listeners = [];


/** A language dictionary from a file (cached); no file - empty. */
export function load(code) {
    let d = _tables.get(code);
    if (d === undefined) {
        d = new Map();
        try {
            const raw = assets.read_json(py.os.path.join(DIR, code + '.json'));
            if (py.is_dict(raw)) {
                for (const [k, v] of Object.entries(raw)) d.set(String(k), typeof v === 'string' ? v : py.str(v));
            }
        } catch (e) {
            if (!(e instanceof py.OSError || e instanceof SyntaxError)) throw e;
        }
        _tables.set(code, d);
    }
    return d;
}


export function available() {
    return LANGS.map(x => x.slice());
}


export function is_cjk(code = null) {
    return CJK.includes(code || current());
}


export function current() {
    if (_lang === null) init();
    return _lang;
}


export function t(key, fmt = {}) {
    if (_lang === null) init();
    let s = _cur.get(key);
    if (s === undefined) {
        s = _en.get(key);
        if (s === undefined) return key;
    }
    if (py.bool(fmt)) {
        try {
            s = py.format(s, [], fmt);
        } catch (e) {
            if (!(e instanceof py.KeyError || e instanceof py.IndexError || e instanceof py.ValueError)) throw e;
        }
    }
    return s;
}


export function has(key) {
    if (_lang === null) init();
    return _cur.has(key) || _en.has(key);
}


export function name_of(kind, key) {
    return t(`${kind}.${key}.name`);
}


export function desc_of(kind, key) {
    return t(`${kind}.${key}.desc`);
}


export function player_name() {
    return settings.get('player_name') || t('player.default_name');
}


// ============================================================ language choice
/** The language code by the browser languages (or KHRONIKI_LANG), the nearest of CODES. */
export function detect() {
    const cands = [py.os.environ['KHRONIKI_LANG']];
    try {
        if (typeof navigator !== 'undefined') {
            for (const l of (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])) {
                cands.push(l);
            }
        }
    } catch (e) {
        // no navigator (node tests)
    }
    for (const v of ['LC_ALL', 'LC_MESSAGES', 'LANG', 'LANGUAGE']) {
        cands.push(py.os.environ[v]);
    }
    for (const c of cands) {
        const code = match_code(c);
        if (code) return code;
    }
    return DEFAULT;
}


export function match_code(raw) {
    if (!raw) return null;
    const s = String(raw).split('.')[0].split('@')[0].replaceAll('_', '-');
    if (CODES.includes(s)) return s;
    const low = s.toLowerCase();
    for (const c of CODES) {
        if (c.toLowerCase() === low) return c;
    }
    const base = low.split('-')[0];
    if (base === 'zh') return 'zh-CN';
    if (base === 'pt') return 'pt-BR';
    for (const c of CODES) {
        if (c.toLowerCase().split('-')[0] === base) return c;
    }
    return null;
}


/** The language from the settings; at the first launch - by the browser languages (and remembered). */
export function init() {
    if (_lang !== null) return _lang;
    const forced = match_code(py.os.environ['KHRONIKI_LANG']);
    const saved = match_code(settings.get('language'));
    const code = forced || saved || detect();
    _apply(code);
    if (saved !== code && !forced) {
        try {
            settings.put('language', code);
        } catch (e) {
            // ignore
        }
    }
    return _lang;
}


export function _apply(code) {
    _en = load(DEFAULT);
    _cur = code !== DEFAULT ? load(code) : _en;
    _lang = code;
    relabel();
}


/** Switch the language (in the game and in the menu right away): tables, fonts, subscriber caches. */
export function set_language(code, persist = true) {
    code = match_code(code) || DEFAULT;
    _apply(code);
    for (const fn of _listeners.slice()) {
        try {
            fn(code);
        } catch (e) {
            // ignore
        }
    }
    if (persist) {
        try {
            settings.put('language', code);
        } catch (e) {
            // ignore
        }
    }
    return code;
}


/** Subscribe to language changes (resetting caches with text): fn(code). */
export function on_change(fn) {
    if (!_listeners.includes(fn)) _listeners.push(fn);
    return fn;
}


// ============================================================ tables
/** Fill in 'name' / 'desc' / 'icon' of the data.js and maps.js tables from the current locale. */
export function relabel() {
    if (data == null || !('CIVS' in data)) return;
    for (const [k, d] of Object.entries(data.UNITS)) {
        d['name'] = t(`unit.${k}.name`);
        d['desc'] = t(`unit.${k}.desc`);
    }
    for (const [k, d] of Object.entries(data.BUILDINGS)) {
        d['name'] = t(`building.${k}.name`);
        d['desc'] = t(`building.${k}.desc`);
    }
    for (const [k, d] of Object.entries(data.TECHS)) {
        d['name'] = t(`tech.${k}.name`);
        d['desc'] = t(`tech.${k}.desc`);
        if (has(`tech.${k}.icon`)) d['icon'] = t(`tech.${k}.icon`);
    }
    for (const [k, d] of Object.entries(data.CIVS)) {
        d['name'] = t(`civ.${k}.name`);
        if (Object.hasOwn(d, 'style') || has(`civ.${k}.style`)) d['style'] = t(`civ.${k}.style`);
        const icons = py.get(d, 'bonus_icons');
        if (icons != null) {
            d['bonus'] = icons.map((spec, i) => [spec, t(`civ.${k}.bonus${i + 1}`)]);
        }
        if (py.get(d, 'team_icon') != null) {
            d['team_desc'] = [d['team_icon'], t(`civ.${k}.team`)];
        }
    }
    for (const [k, d] of Object.entries(data.ANIMALS)) {
        d['name'] = t(`animal.${k}.name`);
    }
    for (const [k, d] of Object.entries(data.NODE_DEFS)) {
        d['name'] = t(`node.${k}.name`);
    }
    for (const r of data.RES) {
        data.RES_NAME[r] = t(`res.${r}`);
    }
    data.COLOR_NAMES.splice(0, data.COLOR_NAMES.length, ...COLOR_KEYS.map(c => t(`color.${c}`)));
    data.PLAYER_NAMES.splice(0, data.PLAYER_NAMES.length, t('player.you'), ...data.COLOR_NAMES.slice(1));
    data.AGE_NAMES.splice(0, data.AGE_NAMES.length, ...[0, 1, 2, 3].map(i => t(`age.${i}`)));
    data.DIFF_NAMES.splice(0, data.DIFF_NAMES.length, ...['easy', 'normal', 'hard'].map(k => t(`diff.${k}`)));
    // sys.modules.get('game.maps'): maps.js registers itself in py.modules before calling relabel()
    const maps = modules.maps;
    if (maps != null) {
        for (const [k, d] of Object.entries(maps.MAPS)) {
            d['name'] = t(`map.${k}.name`);
            d['desc'] = t(`map.${k}.desc`);
            maps.NAMES[k] = d['name'];
        }
    }
}
