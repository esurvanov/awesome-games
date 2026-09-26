// A small numpy subset for the port (synth/sound/music, terrain_gfx, sprites3d, menu_art, surfarray views).
// JS has no operator overloading, so `a * b + c` becomes np.add(np.multiply(a, b), c) (aliases: mul/sub/div).
// Arrays are strided N-d views over typed arrays (numpy semantics for broadcasting, views from slicing and .T).
// Random generators are deterministic per seed but NOT bit-identical to numpy's PCG64 (see PORTING.md).
import { Random, mod as pymod } from './py.js';

export const float64 = 'float64', float32 = 'float32', int32 = 'int32', int64 = 'int64', int16 = 'int16',
    uint8 = 'uint8', uint16 = 'uint16', uint32 = 'uint32', bool_ = 'bool', int_ = 'int64', float_ = 'float64';
export { bool_ as bool };
export const pi = Math.PI, e = Math.E, inf = Infinity, nan = NaN, newaxis = null;

const CTOR = {
    float64: Float64Array, float32: Float32Array, int32: Int32Array, int64: Float64Array, int16: Int16Array,
    uint8: Uint8Array, uint16: Uint16Array, uint32: Uint32Array, bool: Uint8Array, uint8c: Uint8ClampedArray,
    int8: Int8Array,
};
const INTS = new Set(['int32', 'int64', 'int16', 'uint8', 'uint16', 'uint32', 'int8', 'uint8c', 'bool']);
function _dt(d) {
    if (d == null) return 'float64';
    if (d === Number || d === 'float' || d === 'f8' || d === 'double') return 'float64';
    if (d === 'int' || d === 'i8' || d === 'intp') return 'int64';
    if (d === 'f4') return 'float32';
    if (d === 'i4') return 'int32';
    if (d === 'u1') return 'uint8';
    if (d === Boolean) return 'bool';
    return d;
}
function _dtOfTyped(t) {
    if (t instanceof Float64Array) return 'float64';
    if (t instanceof Float32Array) return 'float32';
    if (t instanceof Int32Array) return 'int32';
    if (t instanceof Int16Array) return 'int16';
    if (t instanceof Uint8ClampedArray) return 'uint8c';
    if (t instanceof Uint8Array) return 'uint8';
    if (t instanceof Uint16Array) return 'uint16';
    if (t instanceof Uint32Array) return 'uint32';
    if (t instanceof Int8Array) return 'int8';
    return 'float64';
}
function _cstrides(shape) {
    const s = new Array(shape.length);
    let acc = 1;
    for (let i = shape.length - 1; i >= 0; i--) { s[i] = acc; acc *= shape[i]; }
    return s;
}
function _size(shape) { let n = 1; for (const d of shape) n *= d; return n; }
function _castval(dtype, v) {
    if (typeof v === 'boolean') v = v ? 1 : 0;
    if (INTS.has(dtype)) return Math.trunc(v);
    return v;
}

export class NDArray {
    constructor(data, shape, strides = null, offset = 0, dtype = null) {
        this.data = data;
        this.shape = shape;
        this.strides = strides || _cstrides(shape);
        this.offset = offset;
        this.dtype = dtype || _dtOfTyped(data);
    }
    get ndim() { return this.shape.length; }
    get size() { return _size(this.shape); }
    get length() { return this.shape[0]; }
    get T() { return this.transpose(); }
    get contiguous() {
        const cs = _cstrides(this.shape);
        for (let i = 0; i < cs.length; i++) if (this.shape[i] > 1 && cs[i] !== this.strides[i]) return false;
        return true;
    }
    _idx(ix) {
        let o = this.offset;
        for (let i = 0; i < ix.length; i++) {
            let k = ix[i];
            if (k < 0) k += this.shape[i];
            o += k * this.strides[i];
        }
        return o;
    }
    /** a[i, j, ...] for a full index -> number; a partial index -> a view. */
    get(...ix) {
        if (ix.length === this.shape.length) return this.data[this._idx(ix)];
        return this.s(...ix);
    }
    /** a[i, j, ...] = v (full index). */
    set(v, ...ix) { this.data[this._idx(ix)] = _castval(this.dtype, v); }
    /**
     * Basic slicing -> a view. Each argument: an integer (drops the axis), null (the whole axis),
     * [start, stop, step] (null parts = omitted), or np.newaxis via the string '+'.
     *   a[2:5, :, ::2] -> a.s([2, 5], null, [null, null, 2])     a[:, None] -> a.s(null, '+')
     */
    s(...spec) {
        const shape = [], strides = [];
        let off = this.offset, ax = 0;
        for (const sp of spec) {
            if (sp === '+') { shape.push(1); strides.push(0); continue; }
            const n = this.shape[ax], st = this.strides[ax];
            if (typeof sp === 'number') {
                let k = sp < 0 ? sp + n : sp;
                if (k < 0 || k >= n) throw new RangeError('index out of bounds');
                off += k * st;
            } else if (sp == null) {
                shape.push(n); strides.push(st);
            } else {
                let [a, b, step] = sp;
                step = step == null ? 1 : step;
                let start, stop;
                if (step > 0) {
                    start = a == null ? 0 : (a < 0 ? Math.max(0, a + n) : Math.min(a, n));
                    stop = b == null ? n : (b < 0 ? Math.max(0, b + n) : Math.min(b, n));
                } else {
                    start = a == null ? n - 1 : (a < 0 ? Math.max(-1, a + n) : Math.min(a, n - 1));
                    stop = b == null ? -1 : (b < 0 ? Math.max(-1, b + n) : Math.min(b, n - 1));
                }
                const len = step > 0 ? Math.max(0, Math.ceil((stop - start) / step)) : Math.max(0, Math.ceil((stop - start) / step));
                off += start * st;
                shape.push(len); strides.push(st * step);
            }
            ax++;
        }
        for (; ax < this.shape.length; ax++) { shape.push(this.shape[ax]); strides.push(this.strides[ax]); }
        return new NDArray(this.data, shape, strides, off, this.dtype);
    }
    /** a[...] = src (broadcast) or a[spec] = src via a.s(...).assign(src). Returns this. */
    assign(src) {
        const dst = this;
        if (typeof src === 'number' || typeof src === 'boolean') {
            const v = _castval(this.dtype, src);
            _each(dst.shape, dst.strides, dst.offset, o => { dst.data[o] = v; });
            return this;
        }
        src = asarray(src);
        const b = _bstrides(src, dst.shape);
        const sd = src.data, dd = dst.data, cast = INTS.has(dst.dtype);
        _each2(dst.shape, dst.strides, dst.offset, b, src.offset, (o, p) => { dd[o] = cast ? Math.trunc(sd[p]) : sd[p]; });
        return this;
    }
    fill(v) { return this.assign(v); }
    copy() {
        const out = new NDArray(new CTOR[this.dtype](this.size), this.shape.slice(), null, 0, this.dtype);
        return out.assign(this);
    }
    astype(dtype) {
        dtype = _dt(dtype);
        const out = new NDArray(new CTOR[dtype](this.size), this.shape.slice(), null, 0, dtype);
        return out.assign(this);
    }
    /** A contiguous typed array with the elements in C order (a copy unless already contiguous & whole). */
    toTyped() {
        if (this.contiguous && this.offset === 0 && this.data.length === this.size) return this.data;
        return this.copy().data;
    }
    tolist() {
        if (this.ndim === 0) return this.data[this.offset];
        const out = [];
        for (let i = 0; i < this.shape[0]; i++) {
            const v = this.s(i);
            out.push(v.ndim === 0 ? v.data[v.offset] : v.tolist());
        }
        return out;
    }
    item() { return this.data[this.offset]; }
    reshape(...shape) {
        if (shape.length === 1 && Array.isArray(shape[0])) shape = shape[0];
        const n = this.size;
        const neg = shape.indexOf(-1);
        if (neg >= 0) shape[neg] = n / _size(shape.filter((_, i) => i !== neg));
        const src = this.contiguous ? this : this.copy();
        return new NDArray(src.data, shape.slice(), null, src.offset, this.dtype);
    }
    ravel() { return this.reshape(-1); }
    flatten() { return this.copy().reshape(-1); }
    transpose(...axes) {
        if (!axes.length) axes = this.shape.map((_, i) => this.shape.length - 1 - i);
        return new NDArray(this.data, axes.map(a => this.shape[a]), axes.map(a => this.strides[a]), this.offset, this.dtype);
    }
    sum(axis = null) { return sum(this, axis); }
    max(axis = null) { return max(this, axis); }
    min(axis = null) { return min(this, axis); }
    mean(axis = null) { return mean(this, axis); }
    [Symbol.iterator]() {
        const self = this;
        let i = 0;
        return { next() { return i < self.shape[0] ? { value: self.ndim === 1 ? self.data[self.offset + (i++) * self.strides[0]] : self.s(i++), done: false } : { value: undefined, done: true }; }, [Symbol.iterator]() { return this; } };
    }
}

// ------------------------------------------------------------ iteration helpers
function _each(shape, strides, offset, fn) {
    const nd = shape.length;
    if (nd === 0) { fn(offset); return; }
    if (_size(shape) === 0) return;
    if (nd === 1) { const n = shape[0], s = strides[0]; for (let i = 0, o = offset; i < n; i++, o += s) fn(o); return; }
    if (nd === 2) {
        const [n0, n1] = shape, [s0, s1] = strides;
        for (let i = 0; i < n0; i++) for (let j = 0, o = offset + i * s0; j < n1; j++, o += s1) fn(o);
        return;
    }
    const idx = new Array(nd).fill(0);
    let o = offset;
    for (;;) {
        fn(o);
        let d = nd - 1;
        for (; d >= 0; d--) {
            idx[d]++;
            o += strides[d];
            if (idx[d] < shape[d]) break;
            o -= strides[d] * shape[d];
            idx[d] = 0;
        }
        if (d < 0) return;
    }
}
function _each2(shape, sa, oa, sb, ob, fn) {
    const nd = shape.length;
    if (nd === 0) { fn(oa, ob); return; }
    if (_size(shape) === 0) return;
    if (nd === 1) { const n = shape[0]; for (let i = 0, a = oa, b = ob; i < n; i++, a += sa[0], b += sb[0]) fn(a, b); return; }
    if (nd === 2) {
        for (let i = 0; i < shape[0]; i++) {
            let a = oa + i * sa[0], b = ob + i * sb[0];
            for (let j = 0; j < shape[1]; j++, a += sa[1], b += sb[1]) fn(a, b);
        }
        return;
    }
    const idx = new Array(nd).fill(0);
    let a = oa, b = ob;
    for (;;) {
        fn(a, b);
        let d = nd - 1;
        for (; d >= 0; d--) {
            idx[d]++; a += sa[d]; b += sb[d];
            if (idx[d] < shape[d]) break;
            a -= sa[d] * shape[d]; b -= sb[d] * shape[d]; idx[d] = 0;
        }
        if (d < 0) return;
    }
}
function _bshape(...shapes) {
    const nd = Math.max(...shapes.map(s => s.length));
    const out = new Array(nd).fill(1);
    for (const s of shapes) {
        for (let i = 0; i < s.length; i++) {
            const k = nd - s.length + i, d = s[i];
            if (out[k] === 1) out[k] = d;
            else if (d !== 1 && d !== out[k]) throw new RangeError(`operands could not be broadcast together: ${shapes.map(x => '(' + x + ')').join(' ')}`);
        }
    }
    return out;
}
function _bstrides(a, shape) {
    const nd = shape.length, off = nd - a.shape.length;
    const st = new Array(nd).fill(0);
    for (let i = 0; i < a.shape.length; i++) st[off + i] = a.shape[i] === 1 ? 0 : a.strides[i];
    return st;
}

// ------------------------------------------------------------ constructors
function _nested(x, shape) {
    if (Array.isArray(x)) {
        shape.push(x.length);
        if (x.length && (Array.isArray(x[0]) || x[0] instanceof NDArray)) _nested(x[0] instanceof NDArray ? x[0].tolist() : x[0], shape);
    }
    return shape;
}
function _flat(x, out) {
    if (x instanceof NDArray) { _flat(x.tolist(), out); return; }
    if (Array.isArray(x)) for (const v of x) _flat(v, out);
    else out.push(typeof x === 'boolean' ? (x ? 1 : 0) : x);
}
export function array(x, dtype = null) {
    if (x instanceof NDArray) return dtype ? x.astype(dtype) : x.copy();
    if (ArrayBuffer.isView(x)) {
        const dt = dtype ? _dt(dtype) : _dtOfTyped(x);
        const d = new CTOR[dt](x.length);
        d.set(x);
        return new NDArray(d, [x.length], null, 0, dt);
    }
    if (typeof x === 'number' || typeof x === 'boolean') {
        const dt = _dt(dtype);
        const d = new CTOR[dt](1);
        d[0] = +x;
        return new NDArray(d, [], [], 0, dt);
    }
    const shape = _nested(x, []);
    const flat = [];
    _flat(x, flat);
    const dt = _dt(dtype);
    const d = new CTOR[dt](flat.length);
    for (let i = 0; i < flat.length; i++) d[i] = _castval(dt, flat[i]);
    return new NDArray(d, shape, null, 0, dt);
}
export function asarray(x, dtype = null) {
    if (x instanceof NDArray) return dtype && _dt(dtype) !== x.dtype ? x.astype(dtype) : x;
    if (ArrayBuffer.isView(x) && !dtype) return new NDArray(x, [x.length]);
    return array(x, dtype);
}
export function isscalar(x) { return typeof x === 'number' || typeof x === 'boolean'; }
function _shape(s) { return typeof s === 'number' ? [s] : s.slice(); }
export function zeros(shape, dtype = null) { const dt = _dt(dtype); shape = _shape(shape); return new NDArray(new CTOR[dt](_size(shape)), shape, null, 0, dt); }
export function empty(shape, dtype = null) { return zeros(shape, dtype); }
export function ones(shape, dtype = null) { return full(shape, 1, dtype); }
export function full(shape, v, dtype = null) { const a = zeros(shape, dtype); a.data.fill(_castval(a.dtype, v)); return a; }
export function zeros_like(a, dtype = null) { a = asarray(a); return zeros(a.shape, dtype || a.dtype); }
export function ones_like(a, dtype = null) { a = asarray(a); return ones(a.shape, dtype || a.dtype); }
export function full_like(a, v, dtype = null) { a = asarray(a); return full(a.shape, v, dtype || a.dtype); }
export function arange(start, stop = null, step = 1, dtype = null) {
    if (stop == null) { stop = start; start = 0; }
    const n = Math.max(0, Math.ceil((stop - start) / step));
    const dt = _dt(dtype || (Number.isInteger(start) && Number.isInteger(stop) && Number.isInteger(step) ? 'int64' : 'float64'));
    const d = new CTOR[dt](n);
    for (let i = 0; i < n; i++) d[i] = start + i * step;
    return new NDArray(d, [n], null, 0, dt);
}
export function linspace(a, b, num = 50, endpoint = true, dtype = null) {
    const dt = _dt(dtype);
    const d = new CTOR[dt](num);
    const div = endpoint ? num - 1 : num;
    const step = div > 0 ? (b - a) / div : 0;
    for (let i = 0; i < num; i++) d[i] = a + i * step;
    if (endpoint && num > 1) d[num - 1] = b;
    return new NDArray(d, [num], null, 0, dt);
}
export function frombuffer(buf, dtype = 'uint8') {
    const dt = _dt(dtype);
    const C = CTOR[dt];
    let u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : (ArrayBuffer.isView(buf) ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) : Uint8Array.from(buf));
    const copy = u8.slice();
    const d = new C(copy.buffer, 0, copy.byteLength / C.BYTES_PER_ELEMENT);
    return new NDArray(d, [d.length], null, 0, dt);
}

// ------------------------------------------------------------ elementwise
function _resdt(a, b, op) {
    if (op === 'cmp') return 'bool';
    const fa = a && a.dtype, fb = b && b.dtype;
    if ((fa === 'float32' || fa == null) && (fb === 'float32' || fb == null) && (fa || fb)) return 'float32';
    return 'float64';
}
function _binary(a, b, f, op = null) {
    const sa = typeof a === 'number' || typeof a === 'boolean', sb = typeof b === 'number' || typeof b === 'boolean';
    if (sa && sb) return f(+a, +b);
    const A = sa ? null : asarray(a), B = sb ? null : asarray(b);
    const dt = _resdt(A, B, op);
    if (A && B) {
        const shape = _bshape(A.shape, B.shape);
        const out = zeros(shape, dt), od = out.data;
        if (A.contiguous && B.contiguous && A.shape.length === B.shape.length && A.shape.every((d, i) => d === B.shape[i])) {
            const ad = A.data, bd = B.data, ao = A.offset, bo = B.offset, n = od.length;
            for (let i = 0; i < n; i++) od[i] = f(ad[ao + i], bd[bo + i]);
            return out;
        }
        const as = _bstrides(A, shape), bs = _bstrides(B, shape);
        let k = 0;
        const ad = A.data, bd = B.data;
        _each2(shape, as, A.offset, bs, B.offset, (i, j) => { od[k++] = f(ad[i], bd[j]); });
        return out;
    }
    const X = A || B, s = sa ? +a : +b;
    const out = zeros(X.shape, dt), od = out.data, xd = X.data;
    let k = 0;
    if (X.contiguous) {
        const n = od.length, o = X.offset;
        if (sa) for (let i = 0; i < n; i++) od[i] = f(s, xd[o + i]);
        else for (let i = 0; i < n; i++) od[i] = f(xd[o + i], s);
        return out;
    }
    if (sa) _each(X.shape, X.strides, X.offset, i => { od[k++] = f(s, xd[i]); });
    else _each(X.shape, X.strides, X.offset, i => { od[k++] = f(xd[i], s); });
    return out;
}
function _unary(a, f) {
    if (typeof a === 'number' || typeof a === 'boolean') return f(+a);
    const A = asarray(a);
    const out = zeros(A.shape, A.dtype === 'float32' ? 'float32' : 'float64'), od = out.data, ad = A.data;
    if (A.contiguous) { const o = A.offset, n = od.length; for (let i = 0; i < n; i++) od[i] = f(ad[o + i]); return out; }
    let k = 0;
    _each(A.shape, A.strides, A.offset, i => { od[k++] = f(ad[i]); });
    return out;
}
export const add = (a, b) => _binary(a, b, (x, y) => x + y);
export const subtract = (a, b) => _binary(a, b, (x, y) => x - y);
export const multiply = (a, b) => _binary(a, b, (x, y) => x * y);
export const divide = (a, b) => _binary(a, b, (x, y) => x / y);
export const true_divide = divide;
export const power = (a, b) => _binary(a, b, (x, y) => Math.pow(x, y));
export const maximum = (a, b) => _binary(a, b, (x, y) => (x > y || Number.isNaN(x)) ? x : y);
export const minimum = (a, b) => _binary(a, b, (x, y) => (x < y || Number.isNaN(x)) ? x : y);
export const mod = (a, b) => _binary(a, b, (x, y) => (y === 0 ? NaN : pymod(x, y)));
export const remainder = mod;
export const floor_divide = (a, b) => _binary(a, b, (x, y) => Math.floor(x / y));
export const greater = (a, b) => _binary(a, b, (x, y) => (x > y ? 1 : 0), 'cmp');
export const greater_equal = (a, b) => _binary(a, b, (x, y) => (x >= y ? 1 : 0), 'cmp');
export const less = (a, b) => _binary(a, b, (x, y) => (x < y ? 1 : 0), 'cmp');
export const less_equal = (a, b) => _binary(a, b, (x, y) => (x <= y ? 1 : 0), 'cmp');
export const equal = (a, b) => _binary(a, b, (x, y) => (x === y ? 1 : 0), 'cmp');
export const not_equal = (a, b) => _binary(a, b, (x, y) => (x !== y ? 1 : 0), 'cmp');
export const logical_and = (a, b) => _binary(a, b, (x, y) => (x && y ? 1 : 0), 'cmp');
export const logical_or = (a, b) => _binary(a, b, (x, y) => (x || y ? 1 : 0), 'cmp');
export const logical_not = a => { const r = _unary(a, x => (x ? 0 : 1)); return typeof r === 'number' ? r : r.astype('bool'); };
export const mul = multiply, sub = subtract, div = divide;
export const sin = a => _unary(a, Math.sin);
export const cos = a => _unary(a, Math.cos);
export const tan = a => _unary(a, Math.tan);
export const arctan2 = (a, b) => _binary(a, b, Math.atan2);
export const exp = a => _unary(a, Math.exp);
export const log = a => _unary(a, Math.log);
export const log2 = a => _unary(a, Math.log2);
export const log10 = a => _unary(a, Math.log10);
export const sqrt = a => _unary(a, Math.sqrt);
export const abs = a => _unary(a, Math.abs);
export const absolute = abs;
export const negative = a => _unary(a, x => -x);
export const sign = a => _unary(a, x => (x > 0 ? 1 : x < 0 ? -1 : 0));
export const floor = a => _unary(a, Math.floor);
export const ceil = a => _unary(a, Math.ceil);
export const trunc = a => _unary(a, Math.trunc);
/** np.round / np.rint: half to even, like numpy. */
export const rint = a => _unary(a, x => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); });
export const around = (a, decimals = 0) => (decimals === 0 ? rint(a) : _unary(a, x => { const p = 10 ** decimals; const v = x * p; const f = Math.floor(v), d = v - f; return (d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1)) / p; }));
export { around as round };
export const square = a => _unary(a, x => x * x);
export const nan_to_num = (a, nanv = 0.0) => _unary(a, x => (Number.isNaN(x) ? nanv : x === Infinity ? Number.MAX_VALUE : x === -Infinity ? -Number.MAX_VALUE : x));
export function clip(a, lo, hi) {
    if (lo != null && hi != null && typeof lo === 'number' && typeof hi === 'number') return _unary(a, x => (x < lo ? lo : x > hi ? hi : x));
    let r = a;
    if (lo != null) r = maximum(r, lo);
    if (hi != null) r = minimum(r, hi);
    return r;
}
export function where(cond, a, b) {
    const C = asarray(cond);
    const A = typeof a === 'number' ? null : asarray(a), B = typeof b === 'number' ? null : asarray(b);
    const shape = _bshape(C.shape, A ? A.shape : [], B ? B.shape : []);
    const out = zeros(shape, 'float64'), od = out.data;
    const cs = _bstrides(C, shape), as = A ? _bstrides(A, shape) : null, bs = B ? _bstrides(B, shape) : null;
    const idx = new Array(shape.length).fill(0);
    const n = od.length;
    for (let k = 0; k < n; k++) {
        let co = C.offset, ao = A ? A.offset : 0, bo = B ? B.offset : 0;
        for (let d = 0; d < shape.length; d++) { co += idx[d] * cs[d]; if (A) ao += idx[d] * as[d]; if (B) bo += idx[d] * bs[d]; }
        od[k] = C.data[co] ? (A ? A.data[ao] : a) : (B ? B.data[bo] : b);
        for (let d = shape.length - 1; d >= 0; d--) { if (++idx[d] < shape[d]) break; idx[d] = 0; }
    }
    return out;
}
export function isin(a, values) {
    const set = new Set(Array.from(values instanceof NDArray ? values.toTyped() : values));
    const r = _unary(a, x => (set.has(x) ? 1 : 0));
    return typeof r === 'number' ? r : r.astype('bool');
}
/** np.choose(idx, [c0, c1, ...]) with broadcasting of scalars/arrays. */
export function choose(idx, choices) {
    const I = asarray(idx);
    const cs = choices.map(c => (typeof c === 'number' ? c : asarray(c)));
    const shape = _bshape(I.shape, ...cs.filter(c => typeof c !== 'number').map(c => c.shape));
    const out = zeros(shape, 'float64');
    const n = out.size;
    const flatI = broadcast_to(I, shape).copy().data;
    const flatC = cs.map(c => (typeof c === 'number' ? c : broadcast_to(c, shape).copy().data));
    for (let k = 0; k < n; k++) {
        const c = flatC[flatI[k]];
        out.data[k] = typeof c === 'number' ? c : c[k];
    }
    return out;
}
export function broadcast_to(a, shape) {
    a = asarray(a);
    return new NDArray(a.data, shape.slice(), _bstrides(a, shape), a.offset, a.dtype);
}

// ------------------------------------------------------------ reductions
function _reduce(a, axis, init, f, post = null) {
    a = asarray(a);
    if (axis == null) {
        let acc = init;
        const d = a.data;
        _each(a.shape, a.strides, a.offset, o => { acc = f(acc, d[o]); });
        return post ? post(acc, a.size) : acc;
    }
    if (axis < 0) axis += a.ndim;
    const shape = a.shape.filter((_, i) => i !== axis);
    const out = zeros(shape, 'float64');
    const n = a.shape[axis], st = a.strides[axis];
    const rest = new NDArray(a.data, shape, a.strides.filter((_, i) => i !== axis), a.offset, a.dtype);
    let k = 0;
    _each(rest.shape, rest.strides, rest.offset, o => {
        let acc = init;
        for (let i = 0; i < n; i++) acc = f(acc, a.data[o + i * st]);
        out.data[k++] = post ? post(acc, n) : acc;
    });
    return out;
}
export const sum = (a, axis = null) => _reduce(a, axis, 0, (s, x) => s + x);
export const prod = (a, axis = null) => _reduce(a, axis, 1, (s, x) => s * x);
export const mean = (a, axis = null) => _reduce(a, axis, 0, (s, x) => s + x, (s, n) => s / n);
export const max = (a, axis = null) => _reduce(a, axis, -Infinity, (s, x) => (x > s || Number.isNaN(x) ? x : s));
export const min = (a, axis = null) => _reduce(a, axis, Infinity, (s, x) => (x < s || Number.isNaN(x) ? x : s));
export const amax = max, amin = min;
export const any = (a, axis = null) => _reduce(a, axis, 0, (s, x) => (s || x ? 1 : 0));
export const all = (a, axis = null) => _reduce(a, axis, 1, (s, x) => (s && x ? 1 : 0));
export function argmax(a) { a = asarray(a).copy(); let bi = 0; for (let i = 1; i < a.data.length; i++) if (a.data[i] > a.data[bi]) bi = i; return bi; }
export function argmin(a) { a = asarray(a).copy(); let bi = 0; for (let i = 1; i < a.data.length; i++) if (a.data[i] < a.data[bi]) bi = i; return bi; }
function _accum(a, axis, f) {
    a = asarray(a);
    if (axis == null) { a = a.flatten(); axis = 0; }
    const out = a.astype(a.dtype === 'float32' ? 'float32' : 'float64');
    if (axis < 0) axis += out.ndim;
    const n = out.shape[axis], st = out.strides[axis];
    const rest = new NDArray(out.data, out.shape.filter((_, i) => i !== axis), out.strides.filter((_, i) => i !== axis), 0, out.dtype);
    _each(rest.shape, rest.strides, 0, o => {
        for (let i = 1; i < n; i++) out.data[o + i * st] = f(out.data[o + (i - 1) * st], out.data[o + i * st]);
    });
    return out;
}
export const cumsum = (a, axis = null) => _accum(a, axis, (p, x) => p + x);
/** np.maximum.accumulate(a, axis=0) */
export const maximum_accumulate = (a, axis = 0) => _accum(a, axis, (p, x) => (x > p ? x : p));
maximum.accumulate = maximum_accumulate;
export function nonzero(a) {
    a = asarray(a);
    const res = a.shape.map(() => []);
    const idx = new Array(a.ndim).fill(0);
    const c = a.copy();
    for (let k = 0; k < c.data.length; k++) {
        if (c.data[k]) for (let d = 0; d < a.ndim; d++) res[d].push(idx[d]);
        for (let d = a.ndim - 1; d >= 0; d--) { if (++idx[d] < a.shape[d]) break; idx[d] = 0; }
    }
    return res.map(r => array(r, 'int64'));
}

// ------------------------------------------------------------ shape ops
export function concatenate(arrs, axis = 0) {
    arrs = arrs.map(x => asarray(x));
    if (axis < 0) axis += arrs[0].ndim;
    const shape = arrs[0].shape.slice();
    shape[axis] = arrs.reduce((s, x) => s + x.shape[axis], 0);
    const out = zeros(shape, arrs.every(x => x.dtype === 'float32') ? 'float32' : arrs[0].dtype);
    let pos = 0;
    for (const x of arrs) {
        const spec = shape.map((_, i) => (i === axis ? [pos, pos + x.shape[axis]] : null));
        out.s(...spec).assign(x);
        pos += x.shape[axis];
    }
    return out;
}
export function stack(arrs, axis = 0) {
    arrs = arrs.map(x => asarray(x));
    const ex = arrs.map(x => {
        const shape = x.shape.slice(), strides = x.strides.slice();
        const ax = axis < 0 ? axis + x.ndim + 1 : axis;
        shape.splice(ax, 0, 1); strides.splice(ax, 0, 0);
        return new NDArray(x.data, shape, strides, x.offset, x.dtype);
    });
    return concatenate(ex, axis < 0 ? axis + arrs[0].ndim + 1 : axis);
}
export function tile(a, reps) {
    a = asarray(a);
    if (typeof reps === 'number') reps = [reps];
    const nd = Math.max(a.ndim, reps.length);
    const ash = Array(nd - a.ndim).fill(1).concat(a.shape);
    const rp = Array(nd - reps.length).fill(1).concat(reps);
    let cur = a.reshape(ash);
    for (let d = 0; d < nd; d++) if (rp[d] !== 1) cur = concatenate(Array(rp[d]).fill(cur), d);
    return cur.contiguous ? cur : cur.copy();
}
export function repeat(a, n, axis = null) {
    a = asarray(a);
    if (axis == null) { a = a.flatten(); axis = 0; }
    if (axis < 0) axis += a.ndim;
    const shape = a.shape.slice();
    shape[axis] *= n;
    const out = zeros(shape, a.dtype);
    for (let i = 0; i < a.shape[axis]; i++) {
        const src = a.s(...a.shape.map((_, k) => (k === axis ? [i, i + 1] : null)));
        for (let r = 0; r < n; r++) out.s(...shape.map((_, k) => (k === axis ? [i * n + r, i * n + r + 1] : null))).assign(src);
    }
    return out;
}
export function ascontiguousarray(a) { a = asarray(a); return a.contiguous && a.offset === 0 ? a : a.copy(); }
export function interp(x, xp, fp) {
    const XP = asarray(xp).copy().data, FP = asarray(fp).copy().data;
    const f = v => {
        if (v <= XP[0]) return FP[0];
        const n = XP.length;
        if (v >= XP[n - 1]) return FP[n - 1];
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (XP[m] <= v) lo = m; else hi = m; }
        const t = (v - XP[lo]) / (XP[hi] - XP[lo]);
        return FP[lo] + t * (FP[hi] - FP[lo]);
    };
    return _unary(x, f);
}
export const linalg = {
    norm(a) { a = asarray(a); let s = 0; _each(a.shape, a.strides, a.offset, o => { s += a.data[o] * a.data[o]; }); return Math.sqrt(s); },
};
/** with np.errstate(...): a no-op in JS (division by zero gives inf/nan anyway). */
export function errstate() { return { enter() {}, exit() {} }; }

// ------------------------------------------------------------ FFT (any length: radix-2 or Bluestein)
function _fft2(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (inverse ? 2 : -2) * Math.PI / len;
        const wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            const h = len >> 1;
            for (let j = 0; j < h; j++) {
                const a = i + j, b = a + h;
                const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
                re[b] = re[a] - xr; im[b] = im[a] - xi;
                re[a] += xr; im[a] += xi;
                const ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
    }
}
/** In-place complex DFT of any length (unnormalized; inverse=true uses +i). */
export function _dft(re, im, inverse = false) {
    const n = re.length;
    if (n <= 1) return;
    if ((n & (n - 1)) === 0) { _fft2(re, im, inverse); return; }
    // Bluestein
    let m = 1;
    while (m < 2 * n - 1) m <<= 1;
    const sgn = inverse ? 1 : -1;
    const wr = new Float64Array(n), wi = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        const a = sgn * Math.PI * ((k * k) % (2 * n)) / n;
        wr[k] = Math.cos(a); wi[k] = Math.sin(a);
    }
    const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
    for (let k = 0; k < n; k++) {
        ar[k] = re[k] * wr[k] - im[k] * wi[k];
        ai[k] = re[k] * wi[k] + im[k] * wr[k];
    }
    br[0] = wr[0]; bi[0] = -wi[0];
    for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
    _fft2(ar, ai, false); _fft2(br, bi, false);
    for (let k = 0; k < m; k++) {
        const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k];
        ar[k] = r; ai[k] = i;
    }
    _fft2(ar, ai, true);
    for (let k = 0; k < n; k++) {
        const r = ar[k] / m, i = ai[k] / m;
        re[k] = r * wr[k] - i * wi[k];
        im[k] = r * wi[k] + i * wr[k];
    }
}
/** A complex spectrum {re, im} (Float64Array each). mul(gain) multiplies by a real array/scalar. */
export class Complex {
    constructor(re, im) { this.re = re; this.im = im; }
    get length() { return this.re.length; }
    mul(g) {
        const gd = typeof g === 'number' ? null : asarray(g).toTyped();
        const re = new Float64Array(this.re.length), im = new Float64Array(this.re.length);
        for (let i = 0; i < re.length; i++) { const k = gd ? gd[i] : g; re[i] = this.re[i] * k; im[i] = this.im[i] * k; }
        return new Complex(re, im);
    }
}
export const fft = {
    rfft(x, n = null) {
        const X = asarray(x).toTyped();
        n = n == null ? X.length : n;
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = 0; i < Math.min(n, X.length); i++) re[i] = X[i];
        _dft(re, im, false);
        const h = (n >> 1) + 1;
        return new Complex(re.slice(0, h), im.slice(0, h));
    },
    irfft(C, n = null) {
        const h = C.re.length;
        n = n == null ? 2 * (h - 1) : n;
        const re = new Float64Array(n), im = new Float64Array(n);
        const lim = Math.min(h, (n >> 1) + 1);
        for (let k = 0; k < lim; k++) { re[k] = C.re[k]; im[k] = C.im[k]; }
        for (let k = 1; k < n - k && k < lim; k++) { re[n - k] = C.re[k]; im[n - k] = -C.im[k]; }
        if (n % 2 === 0 && n / 2 < lim) im[n / 2] = 0;
        im[0] = 0;
        _dft(re, im, true);
        for (let i = 0; i < n; i++) re[i] /= n;
        return new NDArray(re, [n]);
    },
    rfftfreq(n, d = 1.0) {
        const h = (n >> 1) + 1;
        const out = new Float64Array(h);
        for (let i = 0; i < h; i++) out[i] = i / (n * d);
        return new NDArray(out, [h]);
    },
};

// ------------------------------------------------------------ random (deterministic, not numpy-bit-exact)
class Generator {
    constructor(seed) { this._r = new Random(seed == null ? null : seed); }
    _fill(size, f) {
        if (size == null) return f();
        const a = zeros(typeof size === 'number' ? [size] : size);
        for (let i = 0; i < a.data.length; i++) a.data[i] = f();
        return a;
    }
    random(size = null) { return this._fill(size, () => this._r.random()); }
    uniform(low = 0.0, high = 1.0, size = null) { return this._fill(size, () => low + (high - low) * this._r.random()); }
    standard_normal(size = null) { return this._fill(size, () => this._r.gauss(0, 1)); }
    normal(loc = 0.0, scale = 1.0, size = null) { return this._fill(size, () => loc + scale * this._r.gauss(0, 1)); }
    integers(low, high = null, size = null) {
        if (high == null) { high = low; low = 0; }
        const r = this._fill(size, () => low + this._r._randbelow(high - low));
        return r instanceof NDArray ? r.astype('int64') : r;
    }
    choice(a, size = null, replace = true, p = null) {
        const pop = typeof a === 'number' ? Array.from({ length: a }, (_, i) => i) : Array.from(asarray(a).toTyped());
        const pick = () => {
            if (!p) return pop[this._r._randbelow(pop.length)];
            const P = asarray(p).toTyped();
            let u = this._r.random(), acc = 0;
            for (let i = 0; i < P.length; i++) { acc += P[i]; if (u < acc) return pop[i]; }
            return pop[pop.length - 1];
        };
        if (size == null) return pick();
        if (!replace) {
            const k = typeof size === 'number' ? size : _size(size);
            return array(this._r.sample(pop, k));
        }
        return this._fill(size, pick);
    }
    shuffle(x) {
        if (x instanceof NDArray) { const d = x.copy().tolist(); this._r.shuffle(d); x.assign(d); } else this._r.shuffle(x);
    }
}
export const random = {
    default_rng(seed = null) { return new Generator(seed); },
    Generator,
};
