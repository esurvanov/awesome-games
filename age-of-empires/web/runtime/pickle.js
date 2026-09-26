// pickle replacement: an object-graph serializer to JSON text (savegame.py). Keeps shared references and cycles,
// class instances (registered with py.register_class), Map/Set/TDict/TSet/typed arrays, NaN/Infinity.
// Hooks mirror pickle's persistent_id / persistent_load:
//   dumps(obj, {persistent_id: o => null | <plain JSON id>})     loads(text, {persistent_load: id => object})
// Instances: own enumerable properties, or __getstate__() / __setstate__(state) when the class defines them.
// Functions without a persistent id are saved as null (pickle.py saves lambdas as None too).
import { CLASSES, TDict, TSet } from './py.js';

const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray };

function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
}
function unb64(s) {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}

export class PicklingError extends Error {}

export function dumps(root, { persistent_id = null } = {}) {
    const objs = [];
    const index = new Map();
    const enc = v => {
        if (v === undefined || v === null) return null;
        const t = typeof v;
        if (t === 'boolean' || t === 'string') return v;
        if (t === 'number') {
            if (Number.isFinite(v)) return Object.is(v, -0) ? { $f: '-0' } : v;
            return { $f: Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf' };
        }
        if (t === 'bigint') return { $big: v.toString() };
        if (persistent_id) {
            const pid = persistent_id(v);
            if (pid != null) return { $p: pid };
        }
        if (t === 'function') return null;
        if (t !== 'object') return null;
        let i = index.get(v);
        if (i !== undefined) return { $r: i };
        i = objs.length;
        index.set(v, i);
        objs.push(null);
        let rec;
        if (Array.isArray(v)) rec = { t: 'list', v: v.map(enc) };
        else if (ArrayBuffer.isView(v) && !(v instanceof DataView)) rec = { t: 'typed', k: v.constructor.name, v: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
        else if (v instanceof TDict) rec = { t: 'tdict', v: Array.from(v.entries(), ([k, x]) => [enc(k), enc(x)]) };
        else if (v instanceof TSet) rec = { t: 'tset', v: Array.from(v, enc) };
        else if (v instanceof Map) rec = { t: 'map', c: v.constructor !== Map ? _qual(v.constructor) : undefined, v: Array.from(v.entries(), ([k, x]) => [enc(k), enc(x)]) };
        else if (v instanceof Set) rec = { t: 'set', v: Array.from(v, enc) };
        else {
            const proto = Object.getPrototypeOf(v);
            if (proto === Object.prototype || proto === null) {
                const o = {};
                for (const k of Object.keys(v)) o[k] = enc(v[k]);
                rec = { t: 'dict', v: o };
            } else {
                const C = v.constructor;
                const name = _qual(C);
                const state = typeof v.__getstate__ === 'function' ? v.__getstate__() : _own(v);
                if (typeof v.__getstate__ === 'function') rec = { t: 'obj', c: name, s: enc(state) };
                else {
                    const o = {};
                    for (const k of Object.keys(state)) o[k] = enc(state[k]);
                    rec = { t: 'obj', c: name, v: o };
                }
            }
        }
        objs[i] = rec;
        return { $r: i };
    };
    const r = enc(root);
    return JSON.stringify({ pickle: 1, root: r, objs });
}
function _own(v) { const o = {}; for (const k of Object.keys(v)) o[k] = v[k]; return o; }
function _qual(C) {
    const name = Object.hasOwn(C, '__qualname__') ? C.__qualname__ : null;
    if (!name || CLASSES.get(name) !== C) throw new PicklingError(`class ${C.name} is not registered (py.register_class(${C.name}, 'module.${C.name}'))`);
    return name;
}

export function loads(text, { persistent_load = null } = {}) {
    const data = typeof text === 'string' ? JSON.parse(text) : text;
    const recs = data.objs;
    const shells = new Array(recs.length);
    // 1) empty shells so references (and cycles) resolve
    recs.forEach((r, i) => {
        switch (r.t) {
            case 'list': shells[i] = new Array(r.v.length); break;
            case 'dict': shells[i] = {}; break;
            case 'map': { const C = r.c ? CLASSES.get(r.c) : Map; shells[i] = C && C !== Map ? Reflect.construct(Map, [], C) : new Map(); break; }
            case 'set': shells[i] = new Set(); break;
            case 'tdict': shells[i] = new TDict(); break;
            case 'tset': shells[i] = new TSet(); break;
            case 'typed': { const u8 = unb64(r.v); const T = TYPED[r.k] || Uint8Array; shells[i] = new T(u8.buffer, 0, u8.byteLength / T.BYTES_PER_ELEMENT); break; }
            case 'obj': {
                const C = CLASSES.get(r.c);
                if (!C) throw new PicklingError(`unknown class ${r.c} in save (not registered)`);
                shells[i] = Object.create(C.prototype);
                break;
            }
            default: throw new PicklingError('bad record ' + r.t);
        }
    });
    const dec = v => {
        if (v === null || typeof v !== 'object') return v;
        if ('$r' in v) return shells[v.$r];
        if ('$f' in v) return v.$f === 'nan' ? NaN : v.$f === 'inf' ? Infinity : v.$f === '-inf' ? -Infinity : -0;
        if ('$big' in v) return BigInt(v.$big);
        if ('$p' in v) return persistent_load ? persistent_load(v.$p) : null;
        throw new PicklingError('bad value');
    };
    const setstate = [];
    // 2) fill
    recs.forEach((r, i) => {
        const o = shells[i];
        switch (r.t) {
            case 'list': r.v.forEach((x, k) => { o[k] = dec(x); }); break;
            case 'dict': for (const k of Object.keys(r.v)) o[k] = dec(r.v[k]); break;
            case 'map': for (const [k, x] of r.v) o.set(dec(k), dec(x)); break;
            case 'set': for (const x of r.v) o.add(dec(x)); break;
            case 'obj':
                if ('s' in r) setstate.push([o, r.s]);
                else for (const k of Object.keys(r.v)) o[k] = dec(r.v[k]);
                break;
        }
    });
    // value-keyed containers last: their tuple keys must already be filled
    recs.forEach((r, i) => {
        if (r.t === 'tdict') for (const [k, x] of r.v) shells[i].set(dec(k), dec(x));
        else if (r.t === 'tset') for (const x of r.v) shells[i].add(dec(x));
    });
    // 3) __setstate__ after every container is filled
    for (const [o, s] of setstate) {
        const st = dec(s);
        if (typeof o.__setstate__ === 'function') o.__setstate__(st);
        else Object.assign(o, st);
    }
    return dec(data.root);
}
