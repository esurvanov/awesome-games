// Python idioms for the 1:1 port of game/*.py (see web/PORTING.md).
// Everything here mirrors CPython semantics where the game depends on it: floor division / modulo signs,
// round-half-even, stable sorting with key/reverse, tuple comparison, heapq tie order, str.format / % formatting,
// and an exact MT19937 `random` (same numbers as CPython for the same seed).

// ============================================================ exceptions
export class PyException extends Error {
    constructor(msg = '') {
        super(String(msg));
        this.name = new.target.name;
    }
}
export class ValueError extends PyException {}
export class TypeError_ extends PyException {}
export { TypeError_ as TypeError };
export class KeyError extends PyException {}
export class IndexError extends PyException {}
export class AttributeError extends PyException {}
export class RuntimeError extends PyException {}
export class NotImplementedError extends RuntimeError {}
export class OSError extends PyException {}
export class FileNotFoundError extends OSError {}
export class ZeroDivisionError extends PyException {}
export class AssertionError_ extends PyException {}
export { AssertionError_ as AssertionError };
export class StopIteration extends PyException {}

// ============================================================ numbers
/** a // b (floor division; floats too). Throws ZeroDivisionError like Python. */
export function floordiv(a, b) {
    if (b === 0) throw new ZeroDivisionError('integer division or modulo by zero');
    return Math.floor(a / b);
}
/** a % b with the sign of b (Python). */
export function mod(a, b) {
    if (b === 0) throw new ZeroDivisionError('integer division or modulo by zero');
    const r = a % b;
    return (r !== 0 && (r < 0) !== (b < 0)) ? r + b : r;
}
export function divmod(a, b) {
    return [floordiv(a, b), mod(a, b)];
}
/** int(x): truncation toward zero; int('12') parses base 10 (or base). */
export function int(x, base = 10) {
    if (typeof x === 'string') {
        const s = x.trim().replace(/_/g, '');
        const v = parseInt(s, base);
        if (Number.isNaN(v) || !/^[+-]?[0-9a-zA-Z]+$/.test(s)) throw new ValueError(`invalid literal for int(): '${x}'`);
        return v;
    }
    if (typeof x === 'boolean') return x ? 1 : 0;
    if (typeof x === 'bigint') return Number(x);
    if (!Number.isFinite(x)) throw new ValueError('cannot convert float NaN or infinity to integer');
    return Math.trunc(x);
}
export function float(x) {
    if (typeof x === 'string') {
        const s = x.trim().toLowerCase();
        if (s === 'inf' || s === '+inf' || s === 'infinity') return Infinity;
        if (s === '-inf' || s === '-infinity') return -Infinity;
        if (s === 'nan') return NaN;
        const v = Number(s);
        if (s === '' || Number.isNaN(v)) throw new ValueError(`could not convert string to float: '${x}'`);
        return v;
    }
    return Number(x);
}
/** round(x) -> int with banker's rounding; round(x, n) -> float rounded like CPython (correctly rounded decimal). */
export function round(x, ndigits = null) {
    if (ndigits == null) {
        const f = Math.floor(x);
        const d = x - f;
        if (d > 0.5) return f + 1;
        if (d < 0.5) return f;
        return (f % 2 === 0) ? f : f + 1;
    }
    if (!Number.isFinite(x)) return x;
    if (ndigits >= 0) {
        // CPython rounds the exact binary value; toFixed also uses the exact value but breaks exact ties upward
        const s = _toFixedHalfEven(x, ndigits);
        return Number(s);
    }
    const p = Math.pow(10, -ndigits);
    return round(x / p) * p;
}
function _toFixedHalfEven(x, n) {
    if (n > 100) n = 100;
    const neg = x < 0 || Object.is(x, -0);
    const ax = Math.abs(x);
    if (ax >= 1e21) return (neg ? '-' : '') + BigInt(ax).toString() + (n > 0 ? '.' + '0'.repeat(n) : '');
    // toFixed rounds the exact binary value (like CPython) but breaks EXACT ties upward; CPython breaks them to even
    let s = ax.toFixed(n);
    const full = ax.toFixed(100);
    const dot = full.indexOf('.');
    const tail = full.slice(dot + 1 + n);
    if (tail[0] === '5' && /^0*$/.test(tail.slice(1))) {
        const trunc = n > 0 ? full.slice(0, dot + 1 + n) : full.slice(0, dot);
        const last = trunc.replace('.', '').slice(-1);
        if ((+last) % 2 === 0) s = trunc;
    }
    return neg ? '-' + s : s;
}
export function abs(x) { return Math.abs(x); }
export function bool(x) {
    if (x == null || x === false || x === 0 || x === '' || x === 0n) return false;
    if (typeof x === 'number') return true;     // NaN is truthy in Python
    if (typeof x !== 'object') return !!x;
    if (Array.isArray(x) || ArrayBuffer.isView(x)) return x.length > 0;
    if (typeof x.__bool__ === 'function') return !!x.__bool__();
    if (typeof x.__len__ === 'function') return x.__len__() > 0;
    if (x instanceof Map || x instanceof Set || x instanceof TDict || x instanceof TSet) return x.size > 0;
    if (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null) {
        for (const _ in x) return true;
        return false;
    }
    return true;
}
/** Python truthiness for `a or b` chains: or_(a, b, c) returns the first truthy value (or the last). */
export function or_(...xs) {
    for (let i = 0; i < xs.length - 1; i++) if (bool(xs[i])) return xs[i];
    return xs[xs.length - 1];
}
export function len(x) {
    if (x == null) throw new TypeError_("object of type 'NoneType' has no len()");
    if (typeof x === 'string' || Array.isArray(x) || ArrayBuffer.isView(x)) return x.length;
    if (x instanceof Map || x instanceof Set || x instanceof TDict || x instanceof TSet) return x.size;
    if (typeof x.__len__ === 'function') return x.__len__();
    if (typeof x.length === 'number') return x.length;
    return Object.keys(x).length;
}
/** Python int.bit_length() for non-negative numbers (or BigInt). */
export function bit_length(n) {
    if (typeof n === 'bigint') { if (n < 0n) n = -n; return n === 0n ? 0 : n.toString(2).length; }
    n = Math.abs(n);
    if (n === 0) return 0;
    if (n < 2 ** 31) return 32 - Math.clz32(n);
    return Math.floor(Math.log2(n)) + 1 - (2 ** Math.floor(Math.log2(n)) > n ? 1 : 0);
}
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ============================================================ sequences
/** range(stop) / range(start, stop[, step]) -> a real array (use plain for-loops in hot code). */
export function range(a, b, step = 1) {
    let start = a, stop = b;
    if (b === undefined) { start = 0; stop = a; }
    if (step === 0) throw new ValueError('range() arg 3 must not be zero');
    const out = [];
    if (step > 0) for (let i = start; i < stop; i += step) out.push(i);
    else for (let i = start; i > stop; i += step) out.push(i);
    return out;
}
export function* enumerate(it, start = 0) {
    let i = start;
    for (const x of it) yield [i++, x];
}
export function zip(...its) {
    const arrs = its.map(list);
    const n = arrs.length ? Math.min(...arrs.map(a => a.length)) : 0;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = arrs.map(a => a[i]);
    return out;
}
export function list(it) {
    if (it == null) return [];
    if (Array.isArray(it)) return it.slice();
    if (typeof it === 'string') return Array.from(it);
    if (it instanceof Map || it instanceof TDict) return Array.from(it.keys());
    if (typeof it[Symbol.iterator] === 'function') return Array.from(it);
    if (typeof it === 'object') return Object.keys(it);      // list(dict) -> keys
    throw new TypeError_('object is not iterable');
}
export function reversed(seq) { return list(seq).reverse(); }
/** Python's sum(): numbers use CPython 3.12+'s compensated (Neumaier) float summation, so float sums are
 *  bit-identical to Python's (exact for integers as before). Non-numbers fall back to `+`. */
export function sum(it, start = 0) {
    let s = start, c = 0;
    if (typeof s !== 'number') { for (const x of it) s += x; return s; }
    for (let x of it) {
        if (typeof x !== 'number') {
            if (typeof x === 'boolean') x = x ? 1 : 0;
            else { s = (c && Number.isFinite(c) ? s + c : s) + x; c = 0; continue; }
        }
        const t = s + x;
        if (Math.abs(s) >= Math.abs(x)) c += (s - t) + x;
        else c += (x - t) + s;
        s = t;
    }
    if (c && Number.isFinite(c)) s += c;
    return s;
}
export function any(it) { for (const x of it) if (bool(x)) return true; return false; }
export function all(it) { for (const x of it) if (!bool(x)) return false; return true; }

/** Python comparison: numbers/bools, strings (by code point), arrays (tuples) lexicographically, __lt__ objects. */
export function cmp(a, b) {
    if (a === b) return 0;
    const ta = typeof a, tb = typeof b;
    if ((ta === 'number' || ta === 'boolean' || ta === 'bigint') && (tb === 'number' || tb === 'boolean' || tb === 'bigint')) {
        const x = Number(a), y = Number(b);
        return x < y ? -1 : x > y ? 1 : 0;
    }
    if (ta === 'string' && tb === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if (Array.isArray(a) && Array.isArray(b)) {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
            const c = cmp(a[i], b[i]);
            if (c !== 0) return c;
        }
        return a.length - b.length < 0 ? -1 : a.length > b.length ? 1 : 0;
    }
    if (a != null && typeof a.__lt__ === 'function') return a.__lt__(b) ? -1 : (b != null && typeof b.__lt__ === 'function' && b.__lt__(a)) ? 1 : 0;
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    throw new TypeError_(`'<' not supported between ${ta} and ${tb}`);
}
/** Python ==: deep for arrays (tuples/lists), dicts, sets; 1 == 1.0 == true; objects by __eq__ or identity. */
export function eq(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    const ta = typeof a, tb = typeof b;
    if (ta !== 'object' || tb !== 'object') {
        if ((ta === 'number' || ta === 'boolean') && (tb === 'number' || tb === 'boolean')) return Number(a) === Number(b);
        if (ta === 'object' && typeof a.__eq__ === 'function') return a.__eq__(b);
        if (tb === 'object' && typeof b.__eq__ === 'function') return b.__eq__(a);
        return false;
    }
    if (typeof a.__eq__ === 'function') return a.__eq__(b);
    if (typeof b.__eq__ === 'function') return b.__eq__(a);
    if ((Array.isArray(a) || ArrayBuffer.isView(a)) && (Array.isArray(b) || ArrayBuffer.isView(b))) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
        return true;
    }
    if ((a instanceof Set || a instanceof TSet) && (b instanceof Set || b instanceof TSet)) {
        if (a.size !== b.size) return false;
        for (const x of a) if (!b.has(x)) return false;
        return true;
    }
    if ((a instanceof Map || a instanceof TDict) && (b instanceof Map || b instanceof TDict)) {
        if (a.size !== b.size) return false;
        for (const [k, v] of a) if (!b.has(k) || !eq(v, b.get(k))) return false;
        return true;
    }
    const pa = Object.getPrototypeOf(a), pb = Object.getPrototypeOf(b);
    if ((pa === Object.prototype || pa === null) && (pb === Object.prototype || pb === null)) {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.length !== kb.length) return false;
        for (const k of ka) if (!Object.hasOwn(b, k) || !eq(a[k], b[k])) return false;
        return true;
    }
    return false;
}
export function ne(a, b) { return !eq(a, b); }
/** `x in container` for arrays (by ==), strings (substring), Map/Set/TDict/TSet (keys), plain dicts (own keys). */
export function contains(container, x) {
    if (container == null) throw new TypeError_("argument of type 'NoneType' is not iterable");
    if (typeof container === 'string') return container.includes(x);
    if (Array.isArray(container) || ArrayBuffer.isView(container)) {
        if (typeof x !== 'object' || x === null) {
            for (let i = 0; i < container.length; i++) {
                const v = container[i];
                if (v === x || (typeof v !== 'object' && eq(v, x))) return true;
            }
            return false;
        }
        for (let i = 0; i < container.length; i++) if (eq(container[i], x)) return true;
        return false;
    }
    if (container instanceof Map || container instanceof Set || container instanceof TDict || container instanceof TSet) return container.has(x);
    if (typeof container.__contains__ === 'function') return container.__contains__(x);
    return Object.hasOwn(container, x);
}
export function index(seq, x, start = 0) {
    for (let i = start; i < seq.length; i++) if (eq(seq[i], x)) return i;
    throw new ValueError('x not in list');
}
export function count(seq, x) {
    if (typeof seq === 'string') return x === '' ? seq.length + 1 : seq.split(x).length - 1;
    let n = 0;
    for (const v of seq) if (eq(v, x)) n++;
    return n;
}
/** list.remove(x): removes the first equal element, ValueError if absent. */
export function remove(arr, x) {
    const i = index(arr, x);
    arr.splice(i, 1);
}
/** list.pop([i]) with Python negative indices; IndexError when empty. */
export function pop(arr, i = -1) {
    if (!arr.length) throw new IndexError('pop from empty list');
    if (i < 0) i += arr.length;
    if (i < 0 || i >= arr.length) throw new IndexError('pop index out of range');
    return arr.splice(i, 1)[0];
}
export function insert(arr, i, x) {
    if (i < 0) i = Math.max(0, arr.length + i);
    arr.splice(Math.min(i, arr.length), 0, x);
}
/** list.extend without the argument-count limit of push(...xs). */
export function extend(arr, it) {
    if (Array.isArray(it)) { for (let i = 0; i < it.length; i++) arr.push(it[i]); return; }
    for (const x of it) arr.push(x);
}
/** seq[i] with a negative index; IndexError when out of range. */
export function at(seq, i) {
    const n = seq.length;
    const j = i < 0 ? i + n : i;
    if (j < 0 || j >= n) throw new IndexError('index out of range');
    return seq[j];
}
/** Python slicing seq[start:stop:step] for arrays and strings (null = omitted). */
export function slice(seq, start = null, stop = null, step = null) {
    const n = seq.length;
    step = step == null ? 1 : step;
    if (step === 0) throw new ValueError('slice step cannot be zero');
    const norm = (v, dflt, lo, hi) => {
        if (v == null) return dflt;
        if (v < 0) v += n;
        return v < lo ? lo : v > hi ? hi : v;
    };
    if (step === 1) {
        const a = norm(start, 0, 0, n), b = norm(stop, n, 0, n);
        return seq.slice(a, Math.max(a, b));
    }
    const out = [];
    if (step > 0) {
        const a = norm(start, 0, 0, n), b = norm(stop, n, 0, n);
        for (let i = a; i < b; i += step) out.push(seq[i]);
    } else {
        const a = norm(start, n - 1, -1, n - 1), b = norm(stop, -1, -1, n - 1);
        for (let i = a; i > b; i += step) out.push(seq[i]);
    }
    return typeof seq === 'string' ? out.join('') : out;
}
/** [x] * n and [[...]] * n (shallow, like Python). For nested fresh rows use Array.from. */
export function repeat(arr, n) {
    const out = [];
    for (let i = 0; i < n; i++) for (const x of arr) out.push(x);
    return out;
}

/** sorted(iterable, key=None, reverse=False): stable, Python ordering (see cmp). */
export function sorted(it, key = null, reverse = false) {
    const arr = list(it);
    sort(arr, key, reverse);
    return arr;
}
/** list.sort(key=None, reverse=False) in place. */
export function sort(arr, key = null, reverse = false) {
    const n = arr.length;
    const keys = new Array(n), idx = new Array(n);
    let allNum = true;
    for (let i = 0; i < n; i++) {
        const k = key ? key(arr[i]) : arr[i];
        keys[i] = k;
        idx[i] = i;
        if (typeof k !== 'number') allNum = false;
    }
    const sgn = reverse ? -1 : 1;
    if (allNum) idx.sort((i, j) => (keys[i] < keys[j] ? -sgn : keys[i] > keys[j] ? sgn : i - j));
    else idx.sort((i, j) => (cmp(keys[i], keys[j]) * sgn) || (i - j));
    const copy = arr.slice();
    for (let i = 0; i < n; i++) arr[i] = copy[idx[i]];
    return arr;
}
/** min(iterable, key=None, default=...) -> the FIRST minimal element (Python). Two+ numbers: use Math.min. */
export function min(it, key = null, dflt = undefined) {
    let best, bk, first = true;
    for (const x of it) {
        const k = key ? key(x) : x;
        if (first || cmp(k, bk) < 0) { best = x; bk = k; first = false; }
    }
    if (first) {
        if (dflt !== undefined) return dflt;
        throw new ValueError('min() arg is an empty sequence');
    }
    return best;
}
/** max(iterable, key=None, default=...) -> the FIRST maximal element (Python). */
export function max(it, key = null, dflt = undefined) {
    let best, bk, first = true;
    for (const x of it) {
        const k = key ? key(x) : x;
        if (first || cmp(k, bk) > 0) { best = x; bk = k; first = false; }
    }
    if (first) {
        if (dflt !== undefined) return dflt;
        throw new ValueError('max() arg is an empty sequence');
    }
    return best;
}
export function itemgetter(...idx) {
    return idx.length === 1 ? (o => o[idx[0]]) : (o => idx.map(i => o[i]));
}

// ============================================================ dicts (plain objects with string keys)
/** d.get(k, default) for plain objects, Map, TDict (a stored null/None is returned as-is, like Python). */
export function get(d, k, dflt = null) {
    if (d instanceof Map || d instanceof TDict) return d.has(k) ? d.get(k) : dflt;
    return Object.hasOwn(d, k) ? d[k] : dflt;
}
export function setdefault(d, k, dflt = null) {
    if (d instanceof Map || d instanceof TDict) {
        if (!d.has(k)) d.set(k, dflt);
        return d.get(k);
    }
    if (!Object.hasOwn(d, k)) d[k] = dflt;
    return d[k];
}
/** d.pop(k[, default]); KeyError when absent and no default given. */
export function dpop(d, k, ...dflt) {
    if (d instanceof Map || d instanceof TDict) {
        if (d.has(k)) { const v = d.get(k); d.delete(k); return v; }
    } else if (Object.hasOwn(d, k)) {
        const v = d[k];
        delete d[k];
        return v;
    }
    if (dflt.length) return dflt[0];
    throw new KeyError(String(k));
}
/** d[k] that raises KeyError when missing (use where Python code catches KeyError). */
export function getitem(d, k) {
    if (d instanceof Map || d instanceof TDict) {
        if (!d.has(k)) throw new KeyError(String(k));
        return d.get(k);
    }
    if (!Object.hasOwn(d, k)) throw new KeyError(String(k));
    return d[k];
}
export function keys(d) { return (d instanceof Map || d instanceof TDict) ? Array.from(d.keys()) : Object.keys(d); }
export function values(d) { return (d instanceof Map || d instanceof TDict) ? Array.from(d.values()) : Object.values(d); }
export function items(d) { return (d instanceof Map || d instanceof TDict) ? Array.from(d.entries()) : Object.entries(d); }
export function update(d, other) {
    if (d instanceof Map || d instanceof TDict) {
        for (const [k, v] of items(other)) d.set(k, v);
    } else {
        for (const [k, v] of items(other)) d[k] = v;
    }
    return d;
}
export function is_dict(x) {
    if (x == null || typeof x !== 'object') return false;
    if (x instanceof Map || x instanceof TDict) return true;
    const p = Object.getPrototypeOf(x);
    return p === Object.prototype || p === null;
}
export function is_str(x) { return typeof x === 'string'; }
export function is_num(x) { return typeof x === 'number'; }
export function is_int(x) { return typeof x === 'number' && Number.isInteger(x); }
export function is_list(x) { return Array.isArray(x); }
/** A deep copy of plain data (dict/list/Map/Set/TDict); class instances are shared. copy.deepcopy for data tables. */
export function deepcopy(x) {
    if (x == null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(deepcopy);
    if (ArrayBuffer.isView(x)) return x.slice();
    if (x instanceof TDict) { const t = new TDict(); for (const [k, v] of x) t.set(deepcopy(k), deepcopy(v)); return t; }
    if (x instanceof TSet) return new TSet(Array.from(x, deepcopy));
    if (x instanceof Map) return new Map(Array.from(x, ([k, v]) => [k, deepcopy(v)]));
    if (x instanceof Set) return new Set(Array.from(x, deepcopy));
    if (is_dict(x)) { const o = {}; for (const k in x) o[k] = deepcopy(x[k]); return o; }
    return x;
}

// ============================================================ tuple-keyed containers
/** The key string of a tuple (array of numbers/strings/bools/null, possibly nested). */
export function tkey(t) {
    if (!Array.isArray(t)) return typeof t === 'string' ? JSON.stringify(t) : String(t);
    let allNum = true;
    for (let i = 0; i < t.length; i++) if (typeof t[i] !== 'number') { allNum = false; break; }
    return allNum ? t.join(',') : JSON.stringify(t);
}
/** A Map whose keys are compared by value (tuples/arrays, numbers, strings). Iterates [key, value] like Map. */
export class TDict {
    constructor(entries = null) {
        this._m = new Map();
        if (entries) for (const [k, v] of entries) this.set(k, v);
    }
    get size() { return this._m.size; }
    has(k) { return this._m.has(tkey(k)); }
    get(k, dflt = undefined) { const e = this._m.get(tkey(k)); return e === undefined ? dflt : e[1]; }
    set(k, v) {
        const s = tkey(k);
        const e = this._m.get(s);
        if (e) e[1] = v; else this._m.set(s, [k, v]);
        return this;
    }
    delete(k) { return this._m.delete(tkey(k)); }
    clear() { this._m.clear(); }
    *keys() { for (const e of this._m.values()) yield e[0]; }
    *values() { for (const e of this._m.values()) yield e[1]; }
    *entries() { for (const e of this._m.values()) yield [e[0], e[1]]; }
    [Symbol.iterator]() { return this.entries(); }
    forEach(fn) { for (const e of this._m.values()) fn(e[1], e[0], this); }
}
/** A Set whose members are compared by value (tuples/arrays). */
export class TSet {
    constructor(it = null) {
        this._m = new Map();
        if (it) for (const x of it) this.add(x);
    }
    get size() { return this._m.size; }
    has(x) { return this._m.has(tkey(x)); }
    add(x) { const s = tkey(x); if (!this._m.has(s)) this._m.set(s, x); return this; }
    delete(x) { return this._m.delete(tkey(x)); }
    discard(x) { this._m.delete(tkey(x)); }
    clear() { this._m.clear(); }
    *values() { yield* this._m.values(); }
    keys() { return this.values(); }
    [Symbol.iterator]() { return this._m.values(); }
    forEach(fn) { for (const x of this._m.values()) fn(x, x, this); }
}
/** collections.Counter over a Map (insertion order kept; most_common is stable like CPython). */
export class Counter extends Map {
    constructor(it = null) {
        super();
        if (it) this.update(it);
    }
    get(k) { return super.has(k) ? super.get(k) : 0; }
    inc(k, n = 1) { this.set(k, this.get(k) + n); return this; }
    update(it) {
        if (it instanceof Map) for (const [k, v] of it) this.inc(k, v);
        else if (is_dict(it)) for (const k of Object.keys(it)) this.inc(k, it[k]);
        else for (const x of it) this.inc(x);
        return this;
    }
    most_common(n = null) {
        const arr = sorted(Array.from(this.entries()), e => e[1], true);
        return n == null ? arr : arr.slice(0, n);
    }
    total() { let s = 0; for (const v of this.values()) s += v; return s; }
}
/** collections.defaultdict(factory) as a Map: get(k) creates the default on first access. */
export class DefaultMap extends Map {
    constructor(factory, entries = null) {
        super(entries || []);
        this.default_factory = factory;
    }
    get(k) {
        if (!super.has(k)) super.set(k, this.default_factory());
        return super.get(k);
    }
}

// ============================================================ heapq / bisect (exact CPython algorithms)
function _siftdown(heap, startpos, pos) {
    const newitem = heap[pos];
    while (pos > startpos) {
        const parentpos = (pos - 1) >> 1;
        const parent = heap[parentpos];
        if (cmp(newitem, parent) < 0) { heap[pos] = parent; pos = parentpos; continue; }
        break;
    }
    heap[pos] = newitem;
}
function _siftup(heap, pos) {
    const endpos = heap.length, startpos = pos, newitem = heap[pos];
    let childpos = 2 * pos + 1;
    while (childpos < endpos) {
        const rightpos = childpos + 1;
        if (rightpos < endpos && !(cmp(heap[childpos], heap[rightpos]) < 0)) childpos = rightpos;
        heap[pos] = heap[childpos];
        pos = childpos;
        childpos = 2 * pos + 1;
    }
    heap[pos] = newitem;
    _siftdown(heap, startpos, pos);
}
export function heappush(heap, item) { heap.push(item); _siftdown(heap, 0, heap.length - 1); }
export function heappop(heap) {
    if (!heap.length) throw new IndexError('index out of range');
    const last = heap.pop();
    if (heap.length) {
        const ret = heap[0];
        heap[0] = last;
        _siftup(heap, 0);
        return ret;
    }
    return last;
}
export function heapify(x) { for (let i = (x.length >> 1) - 1; i >= 0; i--) _siftup(x, i); }
export function heappushpop(heap, item) {
    if (heap.length && cmp(heap[0], item) < 0) { const r = heap[0]; heap[0] = item; _siftup(heap, 0); return r; }
    return item;
}
export function bisect_left(a, x, lo = 0, hi = null, key = null) {
    if (hi == null) hi = a.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cmp(key ? key(a[mid]) : a[mid], x) < 0) lo = mid + 1; else hi = mid;
    }
    return lo;
}
export function bisect_right(a, x, lo = 0, hi = null, key = null) {
    if (hi == null) hi = a.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cmp(x, key ? key(a[mid]) : a[mid]) < 0) hi = mid; else lo = mid + 1;
    }
    return lo;
}
export const bisect = bisect_right;
export function insort(a, x, lo = 0, hi = null) { a.splice(bisect_right(a, x, lo, hi), 0, x); }

// ============================================================ strings
export function isprintable(s) { return !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]|[\p{Zs}--[ ]]/v.test(s); }
export function isalnum(s) { return s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s); }
export function isalpha(s) { return s.length > 0 && /^\p{L}+$/u.test(s); }
export function isdigit(s) { return s.length > 0 && /^\p{Nd}+$/u.test(s); }
export function isspace(s) { return s.length > 0 && /^\s+$/u.test(s); }
export function isupper(s) { return /\p{Lu}/u.test(s) && s === s.toUpperCase(); }
export function islower(s) { return /\p{Ll}/u.test(s) && s === s.toLowerCase(); }
function _esc(chars) { return chars.replace(/[\\\]^-]/g, '\\$&'); }
export function strip(s, chars = null) {
    if (chars == null) return s.replace(/^\s+|\s+$/gu, '');
    const c = _esc(chars);
    return s.replace(new RegExp(`^[${c}]+|[${c}]+$`, 'gu'), '');
}
export function lstrip(s, chars = null) {
    if (chars == null) return s.replace(/^\s+/u, '');
    return s.replace(new RegExp(`^[${_esc(chars)}]+`, 'u'), '');
}
export function rstrip(s, chars = null) {
    if (chars == null) return s.replace(/\s+$/u, '');
    return s.replace(new RegExp(`[${_esc(chars)}]+$`, 'u'), '');
}
/** str.split(sep=None, maxsplit=-1) with Python semantics (None = runs of whitespace, no empty strings). */
export function split(s, sep = null, maxsplit = -1) {
    if (sep == null) {
        const out = [];
        let rest = s.replace(/^\s+/u, '');
        while (rest.length) {
            if (maxsplit >= 0 && out.length === maxsplit) { out.push(rest); return out; }
            const m = /\s+/u.exec(rest);
            if (!m) { out.push(rest); break; }
            out.push(rest.slice(0, m.index));
            rest = rest.slice(m.index + m[0].length);
        }
        return out;
    }
    if (sep === '') throw new ValueError('empty separator');
    const parts = s.split(sep);
    if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts;
    return parts.slice(0, maxsplit).concat([parts.slice(maxsplit).join(sep)]);
}
export function rsplit(s, sep = null, maxsplit = -1) {
    if (maxsplit < 0) return split(s, sep);
    if (sep == null) {
        const all = split(s);
        if (all.length <= maxsplit + 1) return all;
        const head = s.replace(/\s+$/u, '');
        let cut = head.length;
        for (let i = 0; i < maxsplit; i++) {
            const tail = all[all.length - 1 - i];
            cut = head.lastIndexOf(tail, cut - 1);
        }
        return [head.slice(0, cut).replace(/\s+$/u, '')].concat(all.slice(all.length - maxsplit));
    }
    const parts = s.split(sep);
    if (parts.length <= maxsplit + 1) return parts;
    return [parts.slice(0, parts.length - maxsplit).join(sep)].concat(parts.slice(parts.length - maxsplit));
}
export function splitlines(s) {
    const out = s.split(/\r\n|\r|\n/);
    if (out.length && out[out.length - 1] === '') out.pop();
    return out;
}
export function partition(s, sep) {
    const i = s.indexOf(sep);
    return i < 0 ? [s, '', ''] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}
export function rpartition(s, sep) {
    const i = s.lastIndexOf(sep);
    return i < 0 ? ['', '', s] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}
export function startswith(s, p) { return Array.isArray(p) ? p.some(x => s.startsWith(x)) : s.startsWith(p); }
export function endswith(s, p) { return Array.isArray(p) ? p.some(x => s.endsWith(x)) : s.endsWith(p); }
export function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s; }
export function title(s) { return s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }
export function ljust(s, w, fill = ' ') { return s.length >= w ? s : s + fill.repeat(w - s.length); }
export function rjust(s, w, fill = ' ') { return s.length >= w ? s : fill.repeat(w - s.length) + s; }
export function center(s, w, fill = ' ') {
    if (s.length >= w) return s;
    const total = w - s.length;
    const left = Math.floor(total / 2) + (total & w & 1);
    return fill.repeat(left) + s + fill.repeat(total - left);
}
export function zfill(s, w) {
    if (s.length >= w) return s;
    const sign = (s[0] === '-' || s[0] === '+') ? s[0] : '';
    return sign + '0'.repeat(w - s.length) + s.slice(sign.length);
}
export function str_repeat(s, n) { return n > 0 ? s.repeat(n) : ''; }

// ---- str() / repr()
/** Python repr of a float value (1.0 -> '1.0', 1e16 -> '1e+16', 1e-05 -> '1e-05'). */
export function float_repr(x) {
    if (Number.isNaN(x)) return 'nan';
    if (x === Infinity) return 'inf';
    if (x === -Infinity) return '-inf';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const e = x.toExponential();            // shortest round-trip digits
    const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(e);
    const sign = m[1], digits = m[2] + (m[3] || ''), exp = parseInt(m[4], 10);
    if (exp < -4 || exp >= 16) {
        const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
        const ae = Math.abs(exp);
        return `${sign}${mant}e${exp < 0 ? '-' : '+'}${ae < 10 ? '0' + ae : ae}`;
    }
    if (exp >= 0) {
        if (digits.length <= exp + 1) return sign + digits + '0'.repeat(exp + 1 - digits.length) + '.0';
        return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
    }
    return sign + '0.' + '0'.repeat(-exp - 1) + digits;
}
/** str(x) for a value that is a float in Python (so 3 prints as '3.0'). */
export function float_str(x) { return float_repr(Number(x)); }
/** str(x): numbers print as ints when integral (use float_str for Python floats), None/True/False, lists. */
export function str(x) {
    if (x === null || x === undefined) return 'None';
    if (x === true) return 'True';
    if (x === false) return 'False';
    if (typeof x === 'number') return Number.isInteger(x) && Math.abs(x) < 1e16 ? String(x) : float_repr(x);
    if (typeof x === 'string') return x;
    if (typeof x === 'bigint') return x.toString();
    if (typeof x.__str__ === 'function') return x.__str__();
    return repr(x);
}
export function repr(x) {
    if (typeof x === 'string') {
        const q = x.includes("'") && !x.includes('"') ? '"' : "'";
        return q + x.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(q === "'" ? /'/g : /"/g, '\\' + q) + q;
    }
    if (x === null || x === undefined || typeof x === 'boolean' || typeof x === 'number' || typeof x === 'bigint') return str(x);
    if (typeof x.__repr__ === 'function') return x.__repr__();
    if (Array.isArray(x)) return '[' + x.map(repr).join(', ') + ']';
    if (x instanceof TSet || x instanceof Set) return x.size ? '{' + Array.from(x, repr).join(', ') + '}' : 'set()';
    if (x instanceof Map || x instanceof TDict) return '{' + Array.from(x, ([k, v]) => repr(k) + ': ' + repr(v)).join(', ') + '}';
    if (is_dict(x)) return '{' + Object.keys(x).map(k => repr(k) + ': ' + repr(x[k])).join(', ') + '}';
    return `<${x.constructor ? x.constructor.name : 'object'} object>`;
}

// ---- format(value, spec): the format-spec mini-language
const _SPEC = /^(?:(.)?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/su;
function _group(intpart, sep) {
    let out = '';
    for (let i = 0; i < intpart.length; i++) {
        if (i && (intpart.length - i) % 3 === 0) out += sep;
        out += intpart[i];
    }
    return out;
}
function _gfmt(x, p, alt, upper) {
    if (p === 0) p = 1;
    if (x === 0) return alt ? '0.' + '0'.repeat(p - 1) : '0';
    const e = Number(Math.abs(x).toExponential(p - 1).split('e')[1]);
    let s;
    if (-4 <= e && e < p) {
        s = _toFixedHalfEven(Math.abs(x), p - 1 - e);
        if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    } else {
        s = Math.abs(x).toExponential(p - 1);
        let [mant, ex] = s.split('e');
        if (!alt && mant.includes('.')) mant = mant.replace(/\.?0+$/, '');
        const n = Number(ex);
        s = mant + 'e' + (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0');
    }
    return upper ? s.toUpperCase() : s;
}
/** format(value, spec) / f'{value:spec}'. Numbers without a type are formatted as ints when integral. */
export function fmt(value, spec = '') {
    if (value != null && typeof value === 'object' && typeof value.__format__ === 'function') return value.__format__(spec);
    const m = _SPEC.exec(spec);
    if (!m) throw new ValueError(`Invalid format specifier '${spec}'`);
    let [, fill, align, sign, , alt, zero, width, grouping, precision, type] = m;
    width = width ? parseInt(width, 10) : 0;
    precision = precision != null ? parseInt(precision, 10) : null;
    if (zero && !align) { fill = '0'; align = '='; }
    fill = fill || ' ';
    let body, pre = '';
    if (typeof value === 'boolean' && type) value = value ? 1 : 0;
    if (typeof value === 'string' || value == null || typeof value === 'boolean' || (typeof value === 'object')) {
        body = str(value);
        if (precision != null) body = body.slice(0, precision);
        align = align || '<';
    } else {
        let x = Number(value);
        const neg = x < 0 || Object.is(x, -0);
        const ax = Math.abs(x);
        if (!type) type = Number.isInteger(x) && precision == null ? 'd' : (precision == null ? 'r' : 'G_');
        switch (type) {
            case 'd': case 'n': body = String(Math.trunc(ax)); break;
            case 'f': case 'F': body = Number.isFinite(ax) ? _toFixedHalfEven(ax, precision == null ? 6 : precision) : (ax === Infinity ? 'inf' : 'nan'); if (alt && !body.includes('.')) body += '.'; break;
            case 'e': case 'E': {
                const s = ax.toExponential(precision == null ? 6 : precision);
                const [mant, ex] = s.split('e');
                const n = Number(ex);
                body = mant + 'e' + (n < 0 ? '-' : '+') + String(Math.abs(n)).padStart(2, '0');
                if (type === 'E') body = body.toUpperCase();
                break;
            }
            case 'g': case 'G': body = _gfmt(ax, precision == null ? 6 : precision, !!alt, type === 'G'); break;
            case 'G_': {                // no type + precision: like g, but keeps one digit after the point
                body = _gfmt(ax, precision, !!alt, false);
                if (!/[.e]/.test(body)) body += '.0';
                break;
            }
            case 'r': body = float_repr(ax); break;
            case '%': body = _toFixedHalfEven(ax * 100, precision == null ? 6 : precision) + '%'; break;
            case 'x': body = Math.trunc(ax).toString(16); if (alt) pre = '0x'; break;
            case 'X': body = Math.trunc(ax).toString(16).toUpperCase(); if (alt) pre = '0X'; break;
            case 'o': body = Math.trunc(ax).toString(8); if (alt) pre = '0o'; break;
            case 'b': body = Math.trunc(ax).toString(2); if (alt) pre = '0b'; break;
            case 'c': body = String.fromCodePoint(x); break;
            default: body = String(ax);
        }
        if (grouping) {
            const dot = body.search(/[.e%]/);
            const ip = dot < 0 ? body : body.slice(0, dot);
            body = _group(ip, grouping) + (dot < 0 ? '' : body.slice(dot));
        }
        const sg = (neg && !(type === 'd' && Math.trunc(x) === 0 && !Object.is(x, -0) && x > -1)) ? '-'
            : (sign === '+' ? '+' : sign === ' ' ? ' ' : '');
        pre = sg + pre;
        align = align || '>';
        if (align === '=') {
            const padn = width - pre.length - body.length;
            if (padn > 0) {
                if (fill === '0' && grouping) {
                    // zero padding with grouping keeps separators (rare) - approximate with plain zeros
                    body = '0'.repeat(padn) + body;
                } else body = fill.repeat(padn) + body;
            }
            return pre + body;
        }
        body = pre + body;
    }
    const padn = width - body.length;
    if (padn <= 0) return body;
    if (align === '<') return body + fill.repeat(padn);
    if (align === '>' || align === '=') return fill.repeat(padn) + body;
    const left = Math.floor(padn / 2);
    return fill.repeat(left) + body + fill.repeat(padn - left);
}
function _field(name, args, kw, auto) {
    let m = /^([^.[]*)(.*)$/.exec(name);
    let head = m[1], rest = m[2];
    let v;
    if (head === '') v = args[auto.i++];
    else if (/^\d+$/.test(head)) v = args[Number(head)];
    else {
        if (kw == null || !(head in kw)) throw new KeyError(head);
        v = kw[head];
    }
    const re = /\.(\w+)|\[([^\]]+)\]/g;
    let mm;
    while ((mm = re.exec(rest))) {
        if (mm[1] !== undefined) v = v[mm[1]];
        else v = /^\d+$/.test(mm[2]) ? v[Number(mm[2])] : v[mm[2]];
    }
    return v;
}
/** str.format: format(template, args=[], kw={}) — '{}', '{0}', '{name}', '{name:spec}', '{x!r}', '{{', '}}'. */
export function format(template, args = [], kw = null) {
    const auto = { i: 0 };
    return template.replace(/\{\{|\}\}|\{([^{}]*)\}/g, (all, inner) => {
        if (all === '{{') return '{';
        if (all === '}}') return '}';
        let conv = null, spec = '';
        let name = inner;
        const ci = name.indexOf(':');
        if (ci >= 0) { spec = name.slice(ci + 1); name = name.slice(0, ci); }
        const bi = name.indexOf('!');
        if (bi >= 0) { conv = name.slice(bi + 1); name = name.slice(0, bi); }
        let v = _field(name, args, kw, auto);
        if (conv === 'r') v = repr(v);
        else if (conv === 's') v = str(v);
        return fmt(v, spec);
    });
}
/** Old-style '%' formatting: percent('%d/%s', [a, b]) or percent('%(n)d', {n: 1}). */
export function percent(template, args) {
    let i = 0;
    const isMap = args != null && !Array.isArray(args) && typeof args === 'object';
    if (!Array.isArray(args) && !isMap) args = [args];
    return template.replace(/%(?:\(([^)]+)\))?([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?([sdifFeEgGxXocr%])/g, (all, key, flags, width, prec, type) => {
        if (type === '%') return '%';
        let v = key != null ? args[key] : args[i++];
        if (width === '*') width = String(v), v = args[i++];
        let spec = '';
        if (flags.includes('-')) spec += '<';
        else if (flags.includes('0') && type !== 's' && type !== 'r') spec += '0';
        if (flags.includes('+')) spec = spec.replace(/^/, '') + '+';
        else if (flags.includes(' ')) spec += ' ';
        if (flags.includes('-') && flags.includes('+')) spec = '<+';
        if (width) spec += width;
        if (prec != null) spec += '.' + prec;
        if (type === 's') return fmt(str(v), spec.replace(/[+ 0]/g, ''));
        if (type === 'r') return fmt(repr(v), spec.replace(/[+ 0]/g, ''));
        if (type === 'i' || type === 'd') return fmt(Math.trunc(Number(v)), spec + 'd');
        return fmt(Number(v), spec + type);
    });
}

// ============================================================ identity, classes, modules
const _ids = new WeakMap();
let _nextId = 1;
/** id(obj): a stable unique integer per object (primitives map to a tagged string). */
export function id(obj) {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return 'v:' + typeof obj + ':' + String(obj);
    let v = _ids.get(obj);
    if (v === undefined) { v = _nextId++; _ids.set(obj, v); }
    return v;
}
/** Python getattr(obj, name, default): the default only when the attribute is missing (a stored None stays). */
export function getattr(obj, name, dflt = undefined) {
    if (obj != null && (typeof obj === 'object' || typeof obj === 'function') && name in obj) return obj[name];
    if (dflt === undefined) throw new AttributeError(name);
    return dflt;
}
export function hasattr(obj, name) { return obj != null && (typeof obj === 'object' || typeof obj === 'function') && name in obj; }
export function setattr(obj, name, v) { obj[name] = v; }

/** Class-level attributes (Python `class X: attr = value`): visible as this.attr and X.attr. Call before mixin(). */
export function classattrs(Cls, attrs) {
    for (const k of Object.keys(attrs)) {
        Object.defineProperty(Cls.prototype, k, { value: attrs[k], writable: true, configurable: true, enumerable: false });
        if (!Object.hasOwn(Cls, k) || typeof Cls[k] !== 'function') Cls[k] = attrs[k];
    }
    if (Object.hasOwn(Cls, '__own__')) for (const k of Object.keys(attrs)) Cls.__own__.set(k, Object.getOwnPropertyDescriptor(Cls.prototype, k));
}
/** @staticmethod callable both as X.m() and this.m(): define `static m()` and call statics(X, 'm'). */
export function statics(Cls, ...names) {
    for (const n of names) Object.defineProperty(Cls.prototype, n, { value: Cls[n], writable: true, configurable: true, enumerable: false });
}
function _own(Cls) {
    if (!Object.hasOwn(Cls, '__own__')) {
        const m = new Map();
        for (const k of Object.getOwnPropertyNames(Cls.prototype)) if (k !== 'constructor') m.set(k, Object.getOwnPropertyDescriptor(Cls.prototype, k));
        Object.defineProperty(Cls, '__own__', { value: m, enumerable: false });
    }
    return Cls.__own__;
}
function _c3(Cls) {
    const bases = Object.hasOwn(Cls, '__bases__') ? Cls.__bases__ : [];
    const seqs = bases.map(b => (Object.hasOwn(b, '__mro__') ? b.__mro__ : _c3(b)).slice()).concat([bases.slice()]);
    const out = [Cls];
    for (;;) {
        const nonempty = seqs.filter(s => s.length);
        if (!nonempty.length) return out;
        let cand = null;
        for (const s of nonempty) {
            const c = s[0];
            if (!nonempty.some(t => t.indexOf(c) > 0)) { cand = c; break; }
        }
        if (!cand) throw new TypeError_('Cannot create a consistent method resolution order (MRO)');
        out.push(cand);
        for (const s of nonempty) if (s[0] === cand) s.shift();
    }
}
/**
 * Python multiple inheritance of mixin classes: `class Game(ScreensUI, HudUI, ...)` ->
 *   class Game { ... }  mixin(Game, ScreensUI, HudUI, ...)
 * Methods/getters/class attrs are copied onto Target.prototype in C3 MRO order (Target's own win).
 */
export function mixin(Target, ...bases) {
    _own(Target);
    for (const b of bases) _own(b);
    Object.defineProperty(Target, '__bases__', { value: bases, enumerable: false, configurable: true });
    const mro = _c3(Target);
    Object.defineProperty(Target, '__mro__', { value: mro, enumerable: false, configurable: true });
    const own = Target.__own__;
    const done = new Set(own.keys());
    for (const C of mro.slice(1)) {
        for (const [k, d] of _own(C)) {
            if (done.has(k)) continue;
            done.add(k);
            Object.defineProperty(Target.prototype, k, d);
        }
    }
    return Target;
}
/** super() inside a mixin method: super_method(ThisClass, this, 'name') -> bound method of the next class in the MRO or null. */
export function super_method(Cls, self, name) {
    const T = self.constructor;
    const mro = Object.hasOwn(T, '__mro__') ? T.__mro__ : [T];
    let i = mro.indexOf(Cls);
    if (i < 0) {
        // plain JS inheritance chain
        let p = Object.getPrototypeOf(Cls.prototype);
        while (p && p !== Object.prototype) {
            const d = Object.getOwnPropertyDescriptor(p, name);
            if (d) return typeof d.value === 'function' ? d.value.bind(self) : (d.get ? d.get.call(self) : d.value);
            p = Object.getPrototypeOf(p);
        }
        return null;
    }
    for (i += 1; i < mro.length; i++) {
        const d = _own(mro[i]).get(name);
        if (d) return typeof d.value === 'function' ? d.value.bind(self) : (d.get ? d.get.call(self) : d.value);
    }
    return null;
}

/** Late-bound module registry for Python function-local imports (`from . import gfx` inside a function):
 *  use `modules.gfx` at call time. web/src/_all.js fills it with every ported module namespace. */
export const modules = Object.create(null);
export function register_modules(map) { Object.assign(modules, map); }

/** Classes whose instances may be saved (pickle.js): register_class(Unit, 'world.Unit'). */
export const CLASSES = new Map();
export function register_class(Cls, qualname = null) {
    const name = qualname || Cls.name;
    CLASSES.set(name, Cls);
    Object.defineProperty(Cls, '__qualname__', { value: name, enumerable: false, configurable: true });
    return Cls;
}


// ---- CPython math.hypot, exactly (vector_norm with dl_mul = TwoProduct, dl_fast_sum = Fast2Sum)
const _f64 = new Float64Array(1), _u32 = new Uint32Array(_f64.buffer);
const _LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
function _frexp_e(x) {           // the exponent e of frexp(x) (x finite, > 0): x = m * 2**e, 0.5 <= m < 1
    _f64[0] = x;
    const hi = _u32[_LE ? 1 : 0];
    const be = (hi >>> 20) & 0x7ff;
    if (be === 0) return _frexp_e(x * 18014398509481984) - 54;    // subnormal: scale by 2**54
    return be - 1022;
}
function _ldexp1(e) {            // 2**e for -1022 <= e <= 1023
    _f64[0] = 0; _u32[_LE ? 1 : 0] = (e + 1023) << 20; return _f64[0];
}
const _SPLIT = 134217729.0;       // 2**27 + 1 (Veltkamp)
function _vector_norm(vec, max, found_nan) {
    if (max === Infinity) return max;
    if (found_nan) return NaN;
    const n = vec.length;
    if (max === 0 || n <= 1) return max;
    const max_e = _frexp_e(max);
    if (max_e < -1023) {
        const DBL_MIN = 2.2250738585072014e-308;
        return DBL_MIN * _vector_norm(vec.map(x => x / DBL_MIN), max / DBL_MIN, found_nan);
    }
    const scale = -max_e < -1022 ? _ldexp1(-max_e + 64) * 5.421010862427522e-20 : _ldexp1(-max_e);   // 2**-64
    let csum = 1.0, frac1 = 0.0, frac2 = 0.0;
    for (let i = 0; i < n; i++) {
        const x = vec[i] * scale;
        // pr = dl_mul(x, x): hi = x*x, lo = exact error (what fma(x, x, -hi) gives)
        const hi = x * x;
        const t = _SPLIT * x, xh = t - (t - x), xl = x - xh;
        const lo = xl * xl - (((hi - xh * xh) - xl * xh) - xh * xl);
        // sm = dl_fast_sum(csum, hi)
        const sx = csum + hi;
        const sy = (csum - sx) + hi;
        csum = sx;
        frac1 += lo;
        frac2 += sy;
    }
    let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
    {
        const nh = -h, hi = nh * h;
        const t1 = _SPLIT * nh, ah = t1 - (t1 - nh), al = nh - ah;
        const t2 = _SPLIT * h, bh = t2 - (t2 - h), bl = h - bh;
        const lo = al * bl - (((hi - ah * bh) - al * bh) - ah * bl);
        const sx = csum + hi;
        const sy = (csum - sx) + hi;
        csum = sx;
        frac1 += lo;
        frac2 += sy;
    }
    const x = csum - 1.0 + (frac1 + frac2);
    h += x / (2.0 * h);
    return h / scale;
}
function _hypot2(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    if (a !== a || b !== b) return (a === Infinity || b === Infinity) ? Infinity : NaN;
    const max = a > b ? a : b;
    if (max === Infinity || max === 0) return max;
    if (max < 2.2250738585072014e-308 || max > 8.98846567431158e307) return _vector_norm([a, b], max, false);
    // scale = 2**-e where max = m * 2**e, 0.5 <= m < 1 (normal numbers only here)
    _f64[0] = max;
    const e = ((_u32[_LE ? 1 : 0] >>> 20) & 0x7ff) - 1022;
    _f64[0] = 0; _u32[_LE ? 1 : 0] = (1023 - e) << 20;
    const scale = _f64[0];
    let csum = 1.0, frac1 = 0.0, frac2 = 0.0;
    let x = a * scale, hi = x * x, t = _SPLIT * x, xh = t - (t - x), xl = x - xh;
    let lo = xl * xl - (((hi - xh * xh) - xl * xh) - xh * xl);
    let sx = csum + hi;
    frac2 += (csum - sx) + hi; csum = sx; frac1 += lo;
    x = b * scale; hi = x * x; t = _SPLIT * x; xh = t - (t - x); xl = x - xh;
    lo = xl * xl - (((hi - xh * xh) - xl * xh) - xh * xl);
    sx = csum + hi;
    frac2 += (csum - sx) + hi; csum = sx; frac1 += lo;
    let h = Math.sqrt(csum - 1.0 + (frac1 + frac2));
    const nh = -h;
    hi = nh * h;
    const t1 = _SPLIT * nh, ah = t1 - (t1 - nh), al = nh - ah;
    const t2 = _SPLIT * h, bh = t2 - (t2 - h), bl = h - bh;
    lo = al * bl - (((hi - ah * bh) - al * bh) - ah * bl);
    sx = csum + hi;
    frac2 += (csum - sx) + hi; csum = sx; frac1 += lo;
    x = csum - 1.0 + (frac1 + frac2);
    h += x / (2.0 * h);
    return h / scale;
}

// ============================================================ math / time / os
export const math = {
    pi: Math.PI, tau: 2 * Math.PI, e: Math.E, inf: Infinity, nan: NaN,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt(x) { if (x < 0) throw new ValueError('math domain error'); return Math.sqrt(x); },
    // CPython's vector_norm (Modules/mathmodule.c): bit-identical to Python's math.hypot / math.dist, so unit
    // movement (step_toward, distances) stays in lockstep with the Python game
    hypot(...a) {
        if (a.length === 2) return _hypot2(a[0], a[1]);
        const v = a.map(Math.abs);
        return _vector_norm(v, v.reduce((m, x) => (x > m ? x : m), 0), v.some(Number.isNaN));
    },
    dist(p, q) {
        if (p.length === 2) return _hypot2(p[0] - q[0], p[1] - q[1]);
        const v = p.map((x, i) => Math.abs(x - q[i]));
        return _vector_norm(v, v.reduce((m, x) => (x > m ? x : m), 0), v.some(Number.isNaN));
    },
    floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, fabs: Math.abs, exp: Math.exp,
    log(x, base) {
        if (x <= 0) throw new ValueError('math domain error');
        return base === undefined ? Math.log(x) : Math.log(x) / Math.log(base);
    },
    log2: Math.log2, log10: Math.log10, log1p: Math.log1p, pow: Math.pow,
    radians(d) { return d * Math.PI / 180; }, degrees(r) { return r * 180 / Math.PI; },
    copysign(x, y) { return (y < 0 || Object.is(y, -0)) ? -Math.abs(x) : Math.abs(x); },
    fmod(x, y) { return x % y; },
    isclose(a, b, rel_tol = 1e-9, abs_tol = 0) { return Math.abs(a - b) <= Math.max(rel_tol * Math.max(Math.abs(a), Math.abs(b)), abs_tol); },
    isfinite: Number.isFinite, isnan: Number.isNaN, isinf(x) { return x === Infinity || x === -Infinity; },
    gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; },
    prod(it, start = 1) { let p = start; for (const x of it) p *= x; return p; },
    comb(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); },
};

const _t0 = (typeof performance !== 'undefined' ? performance : Date).now();
const _now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function _pad(n, w = 2) { return String(n).padStart(w, '0'); }
export const time = {
    perf_counter() { return _now() / 1000; },
    monotonic() { return _now() / 1000; },
    time() { return Date.now() / 1000; },
    sleep() { throw new RuntimeError('time.sleep() cannot block in the browser - restructure as per-frame steps'); },
    /** strftime with the directives the game uses (%Y %m %d %H %M %S %y %b %a %j %%) in local time. */
    strftime(f, t = null) {
        const d = t == null ? new Date() : new Date(t * 1000);
        const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return f.replace(/%([YmdHMSybaj%])/g, (_, c) => ({
            Y: String(d.getFullYear()), m: _pad(d.getMonth() + 1), d: _pad(d.getDate()), H: _pad(d.getHours()),
            M: _pad(d.getMinutes()), S: _pad(d.getSeconds()), y: _pad(d.getFullYear() % 100), b: MON[d.getMonth()],
            a: DAY[d.getDay()], '%': '%',
            j: _pad(Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1, 3),
        })[c]);
    },
};
export { _t0 as _T0 };

function _normpath(p) {
    const abs = p.startsWith('/');
    const out = [];
    for (const part of p.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); continue; }
        out.push(part);
    }
    return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}
/** os / os.path subset. Paths are POSIX strings; asset paths are relative to the repo root ('assets/gen/x.png'),
 *  user files live under os.HOME ('home/...') in storage.js. exists() consults a hook set by assets/storage. */
export const os = {
    sep: '/',
    environ: Object.create(null),       // filled from the page URL query (?KHRONIKI_LANG=ru&NO_SPRITES3D=1)
    _exists_hooks: [],
    _listdir_hooks: [],
    path: {
        sep: '/',
        join(...parts) {
            let out = '';
            for (const p of parts) {
                if (p === '' || p == null) { if (out && !out.endsWith('/')) out += '/'; continue; }
                if (p.startsWith('/')) out = p;
                else out = out === '' ? p : (out.endsWith('/') ? out + p : out + '/' + p);
            }
            return _normpath(out) === '.' && out !== '.' ? out : _normpath(out);
        },
        normpath: _normpath,
        abspath(p) { return _normpath(p); },
        dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : (i === 0 ? '/' : p.slice(0, i)); },
        basename(p) { return p.slice(p.lastIndexOf('/') + 1); },
        splitext(p) {
            const b = p.lastIndexOf('/'), d = p.lastIndexOf('.');
            if (d <= b + 1) return [p, ''];
            let i = b + 1;
            while (i < d && p[i] === '.') i++;
            return i === d ? [p, ''] : [p.slice(0, d), p.slice(d)];
        },
        relpath(p, start = '') {
            const a = _normpath(p).split('/').filter(x => x && x !== '.'), b = _normpath(start || '.').split('/').filter(x => x && x !== '.');
            let i = 0;
            while (i < a.length && i < b.length && a[i] === b[i]) i++;
            const r = [...Array(b.length - i).fill('..'), ...a.slice(i)].join('/');
            return r || '.';
        },
        exists(p) { return os._exists_hooks.some(h => h(_normpath(p))); },
        isfile(p) { return os._exists_hooks.some(h => h(_normpath(p))); },
        expanduser(p) { return p.replace(/^~/, 'home'); },
    },
    listdir(p) {
        const n = _normpath(p);
        const out = new Set();
        let found = false;
        for (const h of os._listdir_hooks) {
            const r = h(n);
            if (r) { found = true; for (const x of r) out.add(x); }
        }
        if (!found) throw new FileNotFoundError(`No such file or directory: '${p}'`);
        return Array.from(out).sort();
    },
    getcwd() { return ''; },
};
try {
    if (typeof location !== 'undefined' && location.search) {
        for (const [k, v] of new URLSearchParams(location.search)) os.environ[k] = v;
    }
} catch { /* not a browser */ }

// ============================================================ random (exact CPython MT19937)
const N = 624, M = 397;
function _sha512(bytes) {
    // FIPS 180-4, BigInt based (only used for Random(str) seeds)
    const K = [
        '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
        'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
        'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
        '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
        '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
        'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
        '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
        '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
        'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
        '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
    ].map(h => BigInt('0x' + h));
    const MASK = (1n << 64n) - 1n;
    const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK;
    let H = ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179'].map(h => BigInt('0x' + h));
    const l = bytes.length;
    const padLen = ((l + 17 + 127) >> 7) << 7;
    const msg = new Uint8Array(padLen);
    msg.set(bytes);
    msg[l] = 0x80;
    const bits = BigInt(l) * 8n;
    for (let i = 0; i < 16; i++) msg[padLen - 1 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);
    const W = new Array(80);
    for (let off = 0; off < padLen; off += 128) {
        for (let t = 0; t < 16; t++) {
            let v = 0n;
            for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(msg[off + t * 8 + j]);
            W[t] = v;
        }
        for (let t = 16; t < 80; t++) {
            const s0 = rotr(W[t - 15], 1) ^ rotr(W[t - 15], 8) ^ (W[t - 15] >> 7n);
            const s1 = rotr(W[t - 2], 19) ^ rotr(W[t - 2], 61) ^ (W[t - 2] >> 6n);
            W[t] = (W[t - 16] + s0 + W[t - 7] + s1) & MASK;
        }
        let [a, b, c, d, e, f, g, h] = H;
        for (let t = 0; t < 80; t++) {
            const S1 = rotr(e, 14) ^ rotr(e, 18) ^ rotr(e, 41);
            const ch = (e & f) ^ (~e & MASK & g);
            const t1 = (h + S1 + ch + K[t] + W[t]) & MASK;
            const S0 = rotr(a, 28) ^ rotr(a, 34) ^ rotr(a, 39);
            const mj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + mj) & MASK;
            h = g; g = f; f = e; e = (d + t1) & MASK; d = c; c = b; b = a; a = (t1 + t2) & MASK;
        }
        H = H.map((x, i) => (x + [a, b, c, d, e, f, g, h][i]) & MASK);
    }
    const out = new Uint8Array(64);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((H[i] >> BigInt(56 - 8 * j)) & 0xffn);
    return out;
}
function _seedKey(a) {
    // -> array of uint32 words (least significant first), as CPython random_seed()
    if (typeof a === 'string') {
        const enc = new TextEncoder().encode(a);
        const all = new Uint8Array(enc.length + 64);
        all.set(enc);
        all.set(_sha512(enc), enc.length);
        let big = 0n;
        for (const b of all) big = (big << 8n) | BigInt(b);
        a = big;
    }
    if (typeof a === 'boolean') a = a ? 1 : 0;
    if (typeof a === 'number') {
        if (!Number.isInteger(a)) throw new TypeError_('float seeds other than integral values are not supported');
        a = BigInt(a);
    }
    if (typeof a !== 'bigint') throw new TypeError_('The only supported seed types are: None, int, float, str');
    if (a < 0n) a = -a;
    const key = [];
    while (a > 0n) { key.push(Number(a & 0xffffffffn)); a >>= 32n; }
    if (!key.length) key.push(0);
    return key;
}
/** random.Random(seed) — callable with or without `new`. Same streams as CPython for int/str seeds. */
export function Random(seed = null) {
    if (!(this instanceof Random)) return new Random(seed);
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    this.gauss_next = null;
    this.seed(seed);
}
Random.prototype._init_genrand = function (s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
        const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
        mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.mti = N;
};
Random.prototype._init_by_array = function (key) {
    const mt = this.mt;
    this._init_genrand(19650218);
    let i = 1, j = 0;
    const kl = key.length;
    for (let k = N > kl ? N : kl; k; k--) {
        const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
        mt[i] = ((mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
        i++; j++;
        if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
        if (j >= kl) j = 0;
    }
    for (let k = N - 1; k; k--) {
        const prev = mt[i - 1] ^ (mt[i - 1] >>> 30);
        mt[i] = ((mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
        i++;
        if (i >= N) { mt[0] = mt[N - 1]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.mti = N;
};
Random.prototype._genrand = function () {
    const mt = this.mt;
    let y;
    if (this.mti >= N) {
        let kk = 0;
        for (; kk < N - M; kk++) {
            y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
            mt[kk] = mt[kk + M] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
        }
        for (; kk < N - 1; kk++) {
            y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
            mt[kk] = mt[kk + (M - N)] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
        }
        y = (mt[N - 1] & 0x80000000) | (mt[0] & 0x7fffffff);
        mt[N - 1] = mt[M - 1] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
        this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);
    return y >>> 0;
};
Random.prototype.seed = function (a = null) {
    if (a == null) {
        const w = new Uint32Array(8);
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(w);
        else for (let i = 0; i < 8; i++) w[i] = (Math.random() * 4294967296) >>> 0;
        this._init_by_array(Array.from(w));
    } else {
        this._init_by_array(_seedKey(a));
    }
    this.gauss_next = null;
};
Random.prototype.random = function () {
    const a = this._genrand() >>> 5, b = this._genrand() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
};
/** getrandbits(k): a Number for k <= 53, else a BigInt. */
Random.prototype.getrandbits = function (k) {
    if (k < 0) throw new ValueError('number of bits must be non-negative');
    if (k === 0) return 0;
    if (k <= 32) return this._genrand() >>> (32 - k);
    let big = 0n, shift = 0n;
    let left = k;
    while (left > 0) {
        let r = this._genrand();
        if (left < 32) r >>>= (32 - left);
        big |= BigInt(r) << shift;
        shift += 32n;
        left -= 32;
    }
    return k <= 53 ? Number(big) : big;
};
Random.prototype._randbelow = function (n) {
    if (n <= 0) return 0;
    const k = bit_length(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
};
Random.prototype.randrange = function (start, stop = null, step = 1) {
    if (!Number.isInteger(start) || (stop != null && !Number.isInteger(stop)) || !Number.isInteger(step)) throw new TypeError_('randrange() integer arguments required');
    if (stop == null) {
        if (step !== 1) throw new TypeError_('Missing a non-None stop argument');
        if (start > 0) return this._randbelow(start);
        throw new ValueError('empty range for randrange()');
    }
    const width = stop - start;
    if (step === 1) {
        if (width > 0) return start + this._randbelow(width);
        throw new ValueError(`empty range in randrange(${start}, ${stop})`);
    }
    let n;
    if (step > 0) n = Math.floor((width + step - 1) / step);
    else if (step < 0) n = Math.floor((width + step + 1) / step);
    else throw new ValueError('zero step for randrange()');
    if (n <= 0) throw new ValueError('empty range for randrange()');
    return start + step * this._randbelow(n);
};
Random.prototype.randint = function (a, b) { return this.randrange(a, b + 1); };
Random.prototype.choice = function (seq) {
    const n = len(seq);
    if (!n) throw new IndexError('Cannot choose from an empty sequence');
    return seq[this._randbelow(n)];
};
Random.prototype.shuffle = function (x) {
    for (let i = x.length - 1; i > 0; i--) {
        const j = this._randbelow(i + 1);
        const t = x[i]; x[i] = x[j]; x[j] = t;
    }
};
Random.prototype.sample = function (population, k) {
    if (population instanceof Set || population instanceof TSet) throw new TypeError_('Population must be a sequence');
    const pop = Array.isArray(population) || typeof population === 'string' ? population : list(population);
    const n = pop.length;
    if (!(0 <= k && k <= n)) throw new ValueError('Sample larger than population or is negative');
    const result = new Array(k).fill(null);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setsize) {
        const pool = Array.from(pop);
        for (let i = 0; i < k; i++) {
            const j = this._randbelow(n - i);
            result[i] = pool[j];
            pool[j] = pool[n - i - 1];
        }
    } else {
        const selected = new Set();
        for (let i = 0; i < k; i++) {
            let j = this._randbelow(n);
            while (selected.has(j)) j = this._randbelow(n);
            selected.add(j);
            result[i] = pop[j];
        }
    }
    return result;
};
/** choices(population, weights=None, cum_weights=None, k=1) — positional per PORTING.md kwargs rule. */
Random.prototype.choices = function (population, weights = null, cum_weights = null, k = 1) {
    const n = population.length;
    const out = [];
    if (cum_weights == null) {
        if (weights == null) {
            for (let i = 0; i < k; i++) out.push(population[Math.floor(this.random() * n)]);
            return out;
        }
        cum_weights = [];
        let s = 0;
        for (const w of weights) { s += w; cum_weights.push(s); }
    } else if (weights != null) throw new TypeError_('Cannot specify both weights and cumulative weights');
    if (cum_weights.length !== n) throw new ValueError('The number of weights does not match the population');
    const total = cum_weights[cum_weights.length - 1] + 0.0;
    if (total <= 0.0) throw new ValueError('Total of weights must be greater than zero');
    const hi = n - 1;
    for (let i = 0; i < k; i++) out.push(population[bisect_right(cum_weights, this.random() * total, 0, hi)]);
    return out;
};
Random.prototype.uniform = function (a, b) { return a + (b - a) * this.random(); };
Random.prototype.triangular = function (low = 0.0, high = 1.0, mode = null) {
    let u = this.random();
    let c;
    try { c = mode == null ? 0.5 : (mode - low) / (high - low); } catch { return low; }
    if (high === low) return low;
    if (u > c) { u = 1.0 - u; c = 1.0 - c; [low, high] = [high, low]; }
    return low + (high - low) * Math.sqrt(u * c);
};
Random.prototype.gauss = function (mu = 0.0, sigma = 1.0) {
    let z = this.gauss_next;
    this.gauss_next = null;
    if (z == null) {
        const x2pi = this.random() * 2 * Math.PI;
        const g2rad = Math.sqrt(-2.0 * Math.log(1.0 - this.random()));
        z = Math.cos(x2pi) * g2rad;
        this.gauss_next = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
};
const NV_MAGICCONST = 4 * Math.exp(-0.5) / Math.sqrt(2.0);
Random.prototype.normalvariate = function (mu = 0.0, sigma = 1.0) {
    let z;
    for (;;) {
        const u1 = this.random();
        const u2 = 1.0 - this.random();
        z = NV_MAGICCONST * (u1 - 0.5) / u2;
        const zz = z * z / 4.0;
        if (zz <= -Math.log(u2)) break;
    }
    return mu + z * sigma;
};
Random.prototype.expovariate = function (lambd = 1.0) { return -Math.log(1.0 - this.random()) / lambd; };
/** getstate() -> [3, [624 words..., index], gauss_next] (JSON-safe; CPython's shape). */
Random.prototype.getstate = function () {
    return [3, Array.from(this.mt).concat([this.mti]), this.gauss_next];
};
Random.prototype.setstate = function (state) {
    const [version, internal, gn] = state;
    if (version !== 3 && version !== 2) throw new ValueError('state with version ' + version + ' passed to Random.setstate()');
    for (let i = 0; i < N; i++) this.mt[i] = internal[i] >>> 0;
    this.mti = internal[N];
    this.gauss_next = gn == null ? null : gn;
};

const _inst = new Random();
/** The `random` module: random.uniform(...), random.seed(n), random.Random(k) (with or without new). */
export const random = {
    Random,
    seed: (a = null) => _inst.seed(a),
    random: () => _inst.random(),
    uniform: (a, b) => _inst.uniform(a, b),
    randint: (a, b) => _inst.randint(a, b),
    randrange: (a, b = null, s = 1) => _inst.randrange(a, b, s),
    choice: seq => _inst.choice(seq),
    choices: (p, w = null, cw = null, k = 1) => _inst.choices(p, w, cw, k),
    shuffle: x => _inst.shuffle(x),
    sample: (p, k) => _inst.sample(p, k),
    gauss: (m = 0, s = 1) => _inst.gauss(m, s),
    normalvariate: (m = 0, s = 1) => _inst.normalvariate(m, s),
    triangular: (a = 0, b = 1, c = null) => _inst.triangular(a, b, c),
    expovariate: l => _inst.expovariate(l),
    getrandbits: k => _inst.getrandbits(k),
    getstate: () => _inst.getstate(),
    setstate: s => _inst.setstate(s),
    _inst,
};

// saves (pickle.js): collections.Counter instances stored on the world (ai_army.ArmyPlanner.mix) - added by G9
register_class(Counter, 'collections.Counter');
