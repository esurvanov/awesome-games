// A synchronous virtual file system for user files (settings, saves, thumbnails), mirrored in memory and persisted
// to IndexedDB (localStorage fallback). The Python code keeps its files under ~/.cache/khroniki; here that folder is
// the path prefix HOME = 'home'  (settings.py: PATH = os.path.join(storage.HOME, 'settings.json')).
// Reads/writes are synchronous like Python's open(); persistence happens in the background (flush() awaits it).
import { os, FileNotFoundError } from './py.js';

export const HOME = 'home';
const DB = 'khroniki', STORE = 'files', LS_PREFIX = 'khroniki:';

const _files = new Map();     // path -> {data: string | Uint8Array, mtime: seconds}
const _images = new Map();    // path -> ImageBitmap | canvas (decoded .png files, for pygame.image.load)
let _db = null;
let _mode = 'memory';          // 'idb' | 'local' | 'memory'
let _chain = Promise.resolve();
let _ready = false;
// other tabs of the same site share the store: every write is broadcast so their in-memory mirror stays current
// (otherwise a tab would read-merge-write settings.json from a stale copy and drop the other tab's changes)
let _bc = null;
const _change_hooks = [];
/** fn(path) is called after another tab changed or removed a file. */
export function on_change(fn) { _change_hooks.push(fn); }
/** The last persistence failure ({path, error}) or null; the Save dialog reports it (quota full). */
export let last_error = null;
function _broadcast(path, rec) { if (_bc) try { _bc.postMessage({ path, rec }); } catch (e) { console.warn('storage broadcast failed', e); } }

function _norm(p) { return os.path.normpath(p); }

/** Open the store and load every file into memory (also decodes stored PNGs). Call once at boot. */
export async function init() {
    if (_ready) return _mode;
    try {
        if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
        _db = await new Promise((res, rej) => {
            const r = indexedDB.open(DB, 1);
            r.onupgradeneeded = () => r.result.createObjectStore(STORE);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
        });
        const all = await new Promise((res, rej) => {
            const out = [];
            const tx = _db.transaction(STORE, 'readonly');
            const cur = tx.objectStore(STORE).openCursor();
            cur.onsuccess = () => {
                const c = cur.result;
                if (c) { out.push([c.key, c.value]); c.continue(); } else res(out);
            };
            cur.onerror = () => rej(cur.error);
        });
        for (const [k, v] of all) _files.set(k, v);
        _mode = 'idb';
    } catch (e) {
        _db = null;
        try {
            if (typeof window === 'undefined') throw new Error('no browser storage (node)');
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k.startsWith(LS_PREFIX)) continue;
                const v = JSON.parse(localStorage.getItem(k));
                _files.set(k.slice(LS_PREFIX.length), { data: v.b ? _unb64(v.d) : v.d, mtime: v.m });
            }
            _mode = 'local';
        } catch { _mode = 'memory'; }
    }
    for (const [p, v] of _files) if (p.endsWith('.png') && v.data instanceof Uint8Array) await _decodeImage(p, v.data);
    if (_mode !== 'memory' && typeof BroadcastChannel !== 'undefined') {     // not in node (it would keep the process alive)
        _bc = new BroadcastChannel(DB + ':files');
        _bc.onmessage = async ev => {
            const { path, rec } = ev.data || {};
            if (!path) return;
            if (rec) _files.set(path, rec); else _files.delete(path);
            _images.delete(path);
            if (rec && path.endsWith('.png') && rec.data instanceof Uint8Array) await _decodeImage(path, rec.data);
            for (const f of _change_hooks) { try { f(path); } catch (e) { console.warn(e); } }
        };
    }
    os._exists_hooks.push(p => exists(p));
    os._listdir_hooks.push(p => (_isdir(p) ? _children(p) : null));
    _ready = true;
    return _mode;
}
export function mode() { return _mode; }

async function _decodeImage(path, bytes) {
    try {
        _images.set(path, await createImageBitmap(new Blob([bytes], { type: 'image/png' })));
    } catch { /* corrupt thumbnail - ignore */ }
}
function _b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
}
function _unb64(s) {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}
function _fail(path, e) {
    console.warn('storage write failed', path, e);
    last_error = { path, error: e };
}
function _persist(path, rec) {
    _broadcast(path, rec);
    _chain = _chain.then(() => new Promise(res => {
        try {
            if (_mode === 'idb') {
                const tx = _db.transaction(STORE, 'readwrite');
                if (rec) tx.objectStore(STORE).put(rec, path); else tx.objectStore(STORE).delete(path);
                tx.oncomplete = () => res();
                tx.onerror = tx.onabort = () => { _fail(path, tx.error); res(); };
            } else if (_mode === 'local') {
                if (rec) {
                    const bin = rec.data instanceof Uint8Array;
                    localStorage.setItem(LS_PREFIX + path, JSON.stringify({ d: bin ? _b64(rec.data) : rec.data, b: bin, m: rec.mtime }));
                } else localStorage.removeItem(LS_PREFIX + path);
                res();
            } else res();
        } catch (e) { _fail(path, e); res(); }
    }));
    return _chain;
}
/** After a failed write: make the in-memory copy match what is really persisted again (the old file, or none). */
export async function revert(path) {
    path = _norm(path);
    let rec = null;
    try {
        if (_mode === 'local') {
            const v = JSON.parse(localStorage.getItem(LS_PREFIX + path));
            if (v) rec = { data: v.b ? _unb64(v.d) : v.d, mtime: v.m };
        } else if (_mode === 'idb') {
            rec = await new Promise(res => {
                const r = _db.transaction(STORE, 'readonly').objectStore(STORE).get(path);
                r.onsuccess = () => res(r.result || null);
                r.onerror = () => res(null);
            });
        } else return;
    } catch (e) { rec = null; }
    if (rec) _files.set(path, rec); else _files.delete(path);
    _images.delete(path);
    if (rec && path.endsWith('.png') && rec.data instanceof Uint8Array) await _decodeImage(path, rec.data);
}
/** Resolves when every write so far has reached IndexedDB/localStorage. */
export function flush() { return _chain; }

// ------------------------------------------------------------ file API (synchronous)
export function exists(path) { path = _norm(path); return _files.has(path) || _isdir(path); }
export function isfile(path) { return _files.has(_norm(path)); }
function _isdir(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    for (const k of _files.keys()) if (k.startsWith(pre)) return true;
    return p === HOME;
}
function _children(p) {
    const pre = p.endsWith('/') ? p : p + '/';
    const out = new Set();
    for (const k of _files.keys()) if (k.startsWith(pre)) out.add(k.slice(pre.length).split('/')[0]);
    return Array.from(out);
}
export function listdir(dir) {
    dir = _norm(dir);
    if (!_isdir(dir)) throw new FileNotFoundError(`No such file or directory: '${dir}'`);
    return _children(dir).sort();
}
export function read_text(path) {
    const r = _files.get(_norm(path));
    if (!r) throw new FileNotFoundError(`No such file or directory: '${path}'`);
    return typeof r.data === 'string' ? r.data : new TextDecoder().decode(r.data);
}
export function read_bytes(path) {
    const r = _files.get(_norm(path));
    if (!r) throw new FileNotFoundError(`No such file or directory: '${path}'`);
    return typeof r.data === 'string' ? new TextEncoder().encode(r.data) : r.data;
}
export function write_text(path, s) {
    path = _norm(path);
    const rec = { data: String(s), mtime: Date.now() / 1000 };
    _files.set(path, rec);
    return _persist(path, rec);
}
export function write_bytes(path, u8) {
    path = _norm(path);
    const rec = { data: u8 instanceof Uint8Array ? u8 : new Uint8Array(u8), mtime: Date.now() / 1000 };
    _files.set(path, rec);
    if (path.endsWith('.png')) _images.delete(path);
    return _persist(path, rec);
}
export function remove(path) {
    path = _norm(path);
    if (!_files.has(path)) throw new FileNotFoundError(`No such file or directory: '${path}'`);
    _files.delete(path);
    _images.delete(path);
    return _persist(path, null);
}
/** os.replace(src, dst) */
export function replace(src, dst) {
    src = _norm(src); dst = _norm(dst);
    const r = _files.get(src);
    if (!r) throw new FileNotFoundError(`No such file or directory: '${src}'`);
    _files.delete(src);
    _files.set(dst, r);
    const im = _images.get(src);
    _images.delete(src);
    if (im) _images.set(dst, im);
    _persist(src, null);
    return _persist(dst, r);
}
export function getmtime(path) {
    const r = _files.get(_norm(path));
    if (!r) throw new FileNotFoundError(`No such file or directory: '${path}'`);
    return r.mtime;
}
export function makedirs() { /* directories are implicit */ }
/** A decoded image stored at path (a saved thumbnail) for pygame.image.load, or undefined. */
export function image(path) { return _images.get(_norm(path)); }
/** pygame.image.save stores the PNG bytes and a ready canvas (so load() works synchronously right away). */
export function put_image(path, bytes, drawable) {
    path = _norm(path);
    const p = write_bytes(path, bytes);
    _images.set(path, drawable);
    return p;
}
/** Every stored path (for debugging / export). */
export function all_paths() { return Array.from(_files.keys()).sort(); }
