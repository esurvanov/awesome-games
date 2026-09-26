// Asset manifest + loader. Asset paths are relative to the REPOSITORY ROOT: 'assets/gen/atlas.json',
// 'assets/ui/skin/x.png', 'CREDITS.md'. The site root is the repo root (web/ is served next to assets/), so this
// works from `python3 -m http.server` at the repo root and on GitHub Pages under a sub-path.
//
// Everything the Python code reads synchronously (json.load(open(...)), pygame.image.load, font files) must be
// loaded before it is asked for: groups are preloaded (boot before the menu, buildings/portraits in the background,
// awaited by the loading screen), unit sheets are requested one by one (sprites3d).
import { os, FileNotFoundError } from './py.js';

export const ROOT_URL = new URL('../../', import.meta.url);
const MANIFEST_URL = new URL('../assets_manifest.json', import.meta.url);

let _manifest = null;
let _files = null;                // path -> [size] | [size, w, h, alpha]
const _dirs = new Map();          // dir -> Set(child names)
const _text = new Map();          // path -> string (json, md, txt)
const _bytes = new Map();         // path -> Uint8Array (ttf, other binary)
const _img = new Map();           // path -> ImageBitmap
const _audio = new Map();         // path -> AudioBuffer
const _fonts = new Map();         // path -> {family, upem, asc, desc, lineGap}
const _pending = new Map();       // path -> Promise

let _actx = null;
/** The one AudioContext of the page (created suspended; pygame.mixer resumes it on the first user gesture). */
export function get_audio_context() {
    if (_actx === null) {
        const C = globalThis.AudioContext || globalThis.webkitAudioContext;
        _actx = C ? new C({ latencyHint: 'interactive' }) : undefined;
    }
    return _actx || null;
}

// ------------------------------------------------------------ manifest
/** Load the manifest (once). Registers os.path.exists/os.listdir hooks for asset paths. */
export async function init(manifest = null) {
    if (_manifest) return _manifest;
    _manifest = manifest || await (await fetch(MANIFEST_URL, { cache: 'no-cache' })).json();
    _files = _manifest.files;
    for (const p of Object.keys(_files)) {
        const parts = p.split('/');
        for (let i = 0; i < parts.length; i++) {
            const dir = parts.slice(0, i).join('/');
            if (!_dirs.has(dir)) _dirs.set(dir, new Set());
            _dirs.get(dir).add(parts[i]);
        }
    }
    os._exists_hooks.push(p => exists(p));
    os._listdir_hooks.push(p => (_dirs.has(p === '.' ? '' : p) ? Array.from(_dirs.get(p === '.' ? '' : p)) : null));
    return _manifest;
}
export function manifest() { return _manifest; }
export function url(path) { return new URL(path, ROOT_URL).href; }
/** In the manifest (shipped), loaded or not. Directories count too. */
export function exists(path) { return !!_files && (Object.hasOwn(_files, path) || _dirs.has(path)); }
export function info(path) {
    const v = _files && _files[path];
    if (!v) return null;
    return v.length > 1 ? { size: v[0], w: v[1], h: v[2], alpha: !!v[3] } : { size: v[0] };
}
export function listdir(dir) {
    const s = _dirs.get(dir);
    if (!s) throw new FileNotFoundError(`No such file or directory: '${dir}'`);
    return Array.from(s).sort();
}
/** os.walk(dir) -> [[dirpath, dirnames, filenames], ...] from the manifest. */
export function walk(dir) {
    const out = [];
    const rec = d => {
        const names = Array.from(_dirs.get(d) || []).sort();
        const sub = [], files = [];
        for (const n of names) (_dirs.has(d ? d + '/' + n : n) ? sub : files).push(n);
        out.push([d, sub, files]);
        for (const s of sub) rec(d ? d + '/' + s : s);
    };
    if (_dirs.has(dir)) rec(dir);
    return out;
}
/** Answers of `git ...` recorded by web/tools/build_manifest.mjs (menu.py version line / news); '' if unknown. */
export function git(args) { return (_manifest && _manifest.git && _manifest.git[args.join(' ')]) || ''; }

// ------------------------------------------------------------ groups
const _ext = p => p.slice(p.lastIndexOf('.') + 1).toLowerCase();
export const GROUPS = {
    // units: 2.3 GB decoded - never preloaded as a group; sprites3d requests sheets one by one
    units: p => p.startsWith('assets/gen/units/') && _ext(p) === 'png',
    buildings: p => p.startsWith('assets/gen/buildings/') && _ext(p) === 'png',
    portraits: p => p.startsWith('assets/ui/portraits/') && _ext(p) === 'png',
    sfx: p => p.startsWith('assets/audio/sfx/'),
    music: p => p.startsWith('assets/audio/music/'),        // streamed by mixer.music, never preloaded
    // everything else: all json/md/txt, fonts, ui skin/icons/cursors, terrain/nature/decals/walls/maps images
    boot: p => !['units', 'buildings', 'portraits', 'sfx', 'music'].some(g => GROUPS[g](p)),
};
export function group_files(name) { return Object.keys(_files).filter(GROUPS[name]); }
const _groupState = new Map();     // name -> {done, total, promise}
/** [bytes loaded, bytes total] of a group (for loading bars). */
export function group_progress(name) {
    const st = _groupState.get(name);
    if (!st) { const t = group_files(name).reduce((s, p) => s + _files[p][0], 0); return [0, t]; }
    return [st.done, st.total];
}
export function group_ready(name) { const st = _groupState.get(name); return !!st && st.ready; }
/** Load a whole group. onprogress(doneBytes, totalBytes). Concurrency 12 (boot) / 4 (background). */
export function load_group(name, onprogress = null, concurrency = null) {
    let st = _groupState.get(name);
    if (!st) {
        const files = group_files(name);
        st = { done: 0, total: files.reduce((s, p) => s + _files[p][0], 0), ready: false, listeners: [] };
        _groupState.set(name, st);
        st.promise = _pool(files, concurrency || (name === 'boot' ? 8 : 6), p => {
            st.done += _files[p][0];
            for (const f of st.listeners) f(st.done, st.total);
        }).then(() => { st.ready = true; });
    }
    if (onprogress) { st.listeners.push(onprogress); onprogress(st.done, st.total); }
    return st.promise;
}
/** Paths whose load failed after all retries (a later successful request removes them). */
export const failed = new Set();
async function _pool(paths, n, onEach) {
    let i = 0;
    const worker = async () => {
        while (i < paths.length) {
            const p = paths[i++];
            try { await _load(p); failed.delete(p); } catch (e) { console.warn('asset failed:', p, e); failed.add(p); }
            onEach(p);
        }
    };
    await Promise.all(Array.from({ length: Math.min(n, paths.length) }, worker));
}
/** Load specific files (any kind). Resolves when all are loaded (failed ones are logged and skipped). */
export function request(paths, concurrency = 6) {
    if (typeof paths === 'string') paths = [paths];
    return _pool(paths.filter(p => !is_loaded(p)), concurrency, () => {});
}
export function is_loaded(path) { return _text.has(path) || _img.has(path) || _bytes.has(path) || _audio.has(path) || _fonts.has(path); }
/** Drop a decoded image/audio from memory (it can be requested again). */
export function release(path) {
    const b = _img.get(path);
    if (b && b.close) b.close();
    _img.delete(path); _audio.delete(path); _bytes.delete(path); _text.delete(path);
}

function _load(path) {
    if (is_loaded(path)) return Promise.resolve();
    let p = _pending.get(path);
    if (p) return p;
    p = _fetchAndDecode(path).finally(() => _pending.delete(path));
    _pending.set(path, p);
    return p;
}
async function _fetch(path) {
    // a few retries: static servers (python http.server in particular) drop connections under parallel load
    let err;
    for (let i = 0; i < 4; i++) {
        try {
            const res = await fetch(url(path));
            if (res.ok) return res;
            err = new Error(`HTTP ${res.status} for ${path}`);
            if (res.status === 404) break;
        } catch (e) { err = e; }
        await new Promise(r => setTimeout(r, 200 * (i + 1)));
    }
    throw err;
}
async function _fetchAndDecode(path) {
    const ext = _ext(path);
    const res = await _fetch(path);
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
        const blob = await res.blob();
        _img.set(path, await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'default' }));
    } else if (ext === 'json' || ext === 'md' || ext === 'txt' || ext === 'csv') {
        _text.set(path, await res.text());
    } else if (ext === 'ttf' || ext === 'otf' || ext === 'woff' || ext === 'woff2') {
        const buf = await res.arrayBuffer();
        await _registerFont(path, buf);
        _bytes.set(path, new Uint8Array(buf));
    } else if (ext === 'opus' || ext === 'ogg' || ext === 'wav' || ext === 'mp3' || ext === 'flac') {
        const buf = await res.arrayBuffer();
        const ctx = get_audio_context();
        if (!ctx) throw new Error('no Web Audio');
        _audio.set(path, await ctx.decodeAudioData(buf));
    } else {
        _bytes.set(path, new Uint8Array(await res.arrayBuffer()));
    }
}

// ------------------------------------------------------------ synchronous access (Python-style)
function _missing(path) { return new FileNotFoundError(`asset not loaded (or missing): '${path}'`); }
/** open(path).read() for text assets. */
export function read_text(path) {
    const t = _text.get(path);
    if (t === undefined) throw _missing(path);
    return t;
}
/** json.load(open(path)) -> a fresh object each call (callers may mutate it, as in Python). */
export function read_json(path) { return JSON.parse(read_text(path)); }
export function read_bytes(path) {
    const b = _bytes.get(path);
    if (b !== undefined) return b;
    const t = _text.get(path);
    if (t !== undefined) return new TextEncoder().encode(t);
    throw _missing(path);
}
/** The decoded ImageBitmap (or undefined). pygame.image.load wraps it in a Surface. */
export function image(path) { return _img.get(path); }
/** Tests/tools: put already-read content into the caches (node has no fetch of file paths). */
export function _put_text(path, text) { _text.set(path, text); }
export function _put_image(path, drawable) { _img.set(path, drawable); }
export function _put_font(path, info) { _fonts.set(path, info); }
export { _ttfMetrics as ttf_metrics };
export function audio(path) { return _audio.get(path); }
export function font(path) { return _fonts.get(path); }

// ------------------------------------------------------------ fonts: FontFace + SDL_ttf metrics from the TTF tables
function _ttfMetrics(buf) {
    const dv = new DataView(buf);
    const numTables = dv.getUint16(4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
        const o = 12 + i * 16;
        const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
        tables[tag] = dv.getUint32(o + 8);
    }
    const upem = dv.getUint16(tables.head + 18);
    const hh = tables.hhea;
    let asc = dv.getInt16(hh + 4), desc = dv.getInt16(hh + 6), lineGap = dv.getInt16(hh + 8);
    if (asc === 0 && desc === 0 && tables['OS/2']) {
        const os2 = tables['OS/2'];
        asc = dv.getInt16(os2 + 68); desc = dv.getInt16(os2 + 70); lineGap = dv.getInt16(os2 + 72);
    }
    return { upem, asc, desc, lineGap };
}
async function _registerFont(path, buf) {
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
    const family = 'pgf_' + base.replace(/[^A-Za-z0-9_-]/g, '_');
    const m = _ttfMetrics(buf);
    if (typeof FontFace !== 'undefined') {
        const ff = new FontFace(family, buf.slice(0), { style: 'normal', weight: 'normal' });
        await ff.load();
        (globalThis.document ? document.fonts : globalThis.fonts || self.fonts).add(ff);
    }
    _fonts.set(path, { family, ...m });
}
