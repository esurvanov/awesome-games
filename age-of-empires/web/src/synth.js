// port of game/synth.py
// Procedural sound synthesis: envelopes, filters, reverb and "instruments".
//
// Everything is generated from formulas - no sound files. Signals are in the range [-1, 1] with the
// sampling rate SR (set to the mixer via set_rate).
// Representation (numpy -> JS): a mono signal (n,) is a Float64Array; a stereo signal (n, 2) is an
// np.NDArray of shape [n, 2] (float64, C-contiguous: data interleaved L, R). The arithmetic is done
// with plain loops over typed arrays (same formulas, same order), np.js only provides the FFT and the RNG.
// np.random.default_rng is deterministic per seed but not numpy's PCG64 stream (see PORTING.md §7).
import * as py from '../runtime/py.js';
import * as np from '../runtime/np.js';

export let SR = 44100;
export const TAU = 2 * Math.PI;

export function set_rate(sr) {
    SR = Math.trunc(sr);
}

export function n_of(dur) {
    return Math.max(1, py.round(dur * SR));
}

export function tvec(n) {
    const t = new Float64Array(n);
    for (let i = 0; i < n; i++) t[i] = i / SR;
    return t;
}

export function midi_hz(m) {
    return 440.0 * 2.0 ** ((m - 69) / 12.0);
}

export function rng(seed) {
    return np.random.default_rng(seed);
}

// ------------------------------------------------------------ array helpers (numpy expressions -> loops)
/** np.linspace(a, b, num) as a Float64Array (numpy: start + i*step, the last point exactly b). */
export function _linspace(a, b, num) {
    const out = new Float64Array(num);
    if (num <= 0) return out;
    const div = num - 1;
    const step = div > 0 ? (b - a) / div : 0;
    for (let i = 0; i < num; i++) out[i] = a + i * step;
    if (num > 1) out[num - 1] = b;
    return out;
}
/** A Float64Array of length n filled by f(i). */
export function _map(n, f) {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = f(i);
    return out;
}
/** Elementwise a * b (b: array of the same length or a scalar) -> new array. */
export function _mul(a, b) {
    const n = a.length, out = new Float64Array(n);
    if (typeof b === 'number') for (let i = 0; i < n; i++) out[i] = a[i] * b;
    else for (let i = 0; i < n; i++) out[i] = a[i] * b[i];
    return out;
}
/** Elementwise a + b -> new array. */
export function _add(a, b) {
    const n = a.length, out = new Float64Array(n);
    if (typeof b === 'number') for (let i = 0; i < n; i++) out[i] = a[i] + b;
    else for (let i = 0; i < n; i++) out[i] = a[i] + b[i];
    return out;
}
/** r.standard_normal(n) as a Float64Array. */
export function _normal(r, n) {
    return r.standard_normal(n).data;
}
/** A stereo (n, 2) float64 array of zeros. */
export function _stereo(n) {
    return new np.NDArray(new Float64Array(n * 2), [n, 2]);
}
export function _is_stereo(x) {
    return x instanceof np.NDArray && x.shape.length === 2;
}
/** len(x) for mono (Float64Array) and stereo (NDArray (n, 2)). */
export function _len(x) {
    return _is_stereo(x) ? x.shape[0] : x.length;
}
/** Flat samples of a mono or stereo signal (for elementwise work). */
function _flat(x) {
    return _is_stereo(x) ? x.data : x;
}
function _like(x, data) {
    return _is_stereo(x) ? new np.NDArray(data, x.shape.slice()) : data;
}
/** x * k for a mono/stereo signal -> new signal of the same kind. */
export function _scale(x, k) {
    return _like(x, _mul(_flat(x), k));
}
/** max(abs(x)) over all samples. */
export function _absmax(x) {
    const d = _flat(x);
    let m = -Infinity;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m || Number.isNaN(v)) m = v; }
    return m;
}

// ============================================================ envelopes
/** A plateau with smooth (sin^2) attack a and release r (in seconds). */
export function ramp(n, a, r) {
    const e = new Float64Array(n).fill(1);
    const na = Math.min(n, n_of(a)), nr = Math.min(n, n_of(r));
    if (na > 1) {
        const l = _linspace(0, Math.PI / 2, na);
        for (let i = 0; i < na; i++) e[i] = Math.sin(l[i]) ** 2;
    }
    if (nr > 1) {
        const l = _linspace(0, Math.PI / 2, nr);
        for (let i = 0; i < nr; i++) e[n - nr + i] *= Math.cos(l[i]) ** 2;
    }
    return e;
}

/** A strike: fast attack, an exponential decay with the constant tau. */
export function perc(n, tau, attack = 0.002) {
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) e[i] = Math.exp(-(i / SR) / tau);
    const na = Math.min(n, n_of(attack));
    if (na > 1) {
        const l = _linspace(0, 1, na);
        for (let i = 0; i < na; i++) e[i] *= l[i];
    }
    return e;
}

/** Fades the last r seconds - no click at the end (in place, returns x). */
export function tail(x, r = 0.01) {
    const len = _len(x);
    const nr = Math.min(len, n_of(r));
    if (nr > 1) {
        const l = _linspace(1, 0, nr);
        if (_is_stereo(x)) {
            const d = x.data;
            for (let i = 0; i < nr; i++) { const j = (len - nr + i) * 2; d[j] *= l[i]; d[j + 1] *= l[i]; }
        } else {
            for (let i = 0; i < nr; i++) x[len - nr + i] *= l[i];
        }
    }
    return x;
}

// ============================================================ filters (in the frequency domain)
/** The nearest length above of the form 2^a*3^b*5^c - the FFT at it is fast. */
export function fast_len(n) {
    let best = 1;
    while (best < n) best *= 2;            // 1 << (int(n - 1).bit_length())
    let p5 = 1;
    while (p5 < best) {
        let p35 = p5;
        while (p35 < best) {
            let p = p35;
            while (p < n) p *= 2;
            best = Math.min(best, p);
            p35 *= 3;
        }
        p5 *= 5;
    }
    return best;
}

// ------------------------------------------------------------ FFT
// fast_len() sizes are 2^a*3^b*5^c: a mixed-radix Cooley-Tukey for them (np.js would use Bluestein at 2-4x the
// size); other sizes go to np._dft. Same transform as numpy.fft up to float rounding.
const _twid = new Map();       // n -> [cos, sin] of 2*pi*j/n, j < n
function _tw(n) {
    let t = _twid.get(n);
    if (!t) {
        const c = new Float64Array(n), sn = new Float64Array(n);
        for (let j = 0; j < n; j++) { const a = 2 * Math.PI * j / n; c[j] = Math.cos(a); sn[j] = Math.sin(a); }
        t = [c, sn];
        if (_twid.size > 64) _twid.clear();
        _twid.set(n, t);
    }
    return t;
}
function _smooth5(n) {
    for (const p of [2, 3, 5]) while (n % p === 0) n /= p;
    return n === 1;
}
function _fft_rec(n, ir, ii, io, st, or, oi, oo, N, tc, ts, sg) {
    if (n === 1) { or[oo] = ir[io]; oi[oo] = ii[io]; return; }
    const p = n % 4 === 0 ? 4 : n % 2 === 0 ? 2 : n % 3 === 0 ? 3 : 5;
    const m = n / p;
    for (let r = 0; r < p; r++) _fft_rec(m, ir, ii, io + r * st, st * p, or, oi, oo + r * m, N, tc, ts, sg);
    const step = N / n;                 // W_n^j = W_N^(j*step)
    if (p === 2) {
        for (let k = 0; k < m; k++) {
            const a = oo + k, b = a + m, j = k * step;
            const wr = tc[j], wi = sg * ts[j];
            const xr = or[b] * wr - oi[b] * wi, xi = or[b] * wi + oi[b] * wr;
            or[b] = or[a] - xr; oi[b] = oi[a] - xi;
            or[a] += xr; oi[a] += xi;
        }
        return;
    }
    if (p === 4) {
        for (let k = 0; k < m; k++) {
            const i0 = oo + k, i1 = i0 + m, i2 = i1 + m, i3 = i2 + m;
            const j1 = k * step, j2 = 2 * j1, j3 = 3 * j1;
            const w1r = tc[j1], w1i = sg * ts[j1], w2r = tc[j2], w2i = sg * ts[j2], w3r = tc[j3], w3i = sg * ts[j3];
            const a0r = or[i0], a0i = oi[i0];
            const a1r = or[i1] * w1r - oi[i1] * w1i, a1i = or[i1] * w1i + oi[i1] * w1r;
            const a2r = or[i2] * w2r - oi[i2] * w2i, a2i = or[i2] * w2i + oi[i2] * w2r;
            const a3r = or[i3] * w3r - oi[i3] * w3i, a3i = or[i3] * w3i + oi[i3] * w3r;
            const s02r = a0r + a2r, s02i = a0i + a2i, d02r = a0r - a2r, d02i = a0i - a2i;
            const s13r = a1r + a3r, s13i = a1i + a3i, d13r = a1r - a3r, d13i = a1i - a3i;
            // multiply d13 by (sg * i): forward (sg = -1) -> -i, inverse -> +i
            const tr = -sg * d13i, ti = sg * d13r;
            or[i0] = s02r + s13r; oi[i0] = s02i + s13i;
            or[i2] = s02r - s13r; oi[i2] = s02i - s13i;
            or[i1] = d02r + tr; oi[i1] = d02i + ti;
            or[i3] = d02r - tr; oi[i3] = d02i - ti;
        }
        return;
    }
    // generic radix p (3 or 5)
    const yr = new Float64Array(p), yi = new Float64Array(p);
    const Np = N / p;
    for (let k = 0; k < m; k++) {
        for (let r = 0; r < p; r++) {
            const idx = oo + k + r * m, j = (r * k * step) % N;
            const wr = tc[j], wi = sg * ts[j];
            yr[r] = or[idx] * wr - oi[idx] * wi;
            yi[r] = or[idx] * wi + oi[idx] * wr;
        }
        for (let q = 0; q < p; q++) {
            let sr = 0, si = 0;
            for (let r = 0; r < p; r++) {
                const j = ((r * q) % p) * Np;
                const wr = tc[j], wi = sg * ts[j];
                sr += yr[r] * wr - yi[r] * wi;
                si += yr[r] * wi + yi[r] * wr;
            }
            or[oo + k + q * m] = sr; oi[oo + k + q * m] = si;
        }
    }
}
/** In-place complex DFT (unnormalized; inverse=true uses +i), like np._dft. */
export function _rt_fft(re, im, inverse = false) {
    const n = re.length;
    if (n <= 1) return;
    if (!_smooth5(n)) { np._dft(re, im, inverse); return; }
    const [tc, ts] = _tw(n);
    const ir = re.slice(), ii = im.slice();
    _fft_rec(n, ir, ii, 0, 1, re, im, 0, n, tc, ts, inverse ? 1 : -1);
}
/** np.fft.rfft(x, size) -> np.Complex (half spectrum). */
function _rfft(x, size) {
    const re = new Float64Array(size), im = new Float64Array(size);
    re.set(x.length > size ? x.subarray(0, size) : x);
    _rt_fft(re, im, false);
    const h = Math.floor(size / 2) + 1;
    return new np.Complex(re.slice(0, h), im.slice(0, h));
}
/** np.fft.irfft(C, size) -> Float64Array. */
function _irfft(C, n) {
    const h = C.re.length;
    const re = new Float64Array(n), im = new Float64Array(n);
    const lim = Math.min(h, Math.floor(n / 2) + 1);
    for (let k = 0; k < lim; k++) { re[k] = C.re[k]; im[k] = C.im[k]; }
    for (let k = 1; k < n - k && k < lim; k++) { re[n - k] = C.re[k]; im[n - k] = -C.im[k]; }
    if (n % 2 === 0 && n / 2 < lim) im[n / 2] = 0;
    im[0] = 0;
    _rt_fft(re, im, true);
    for (let i = 0; i < n; i++) re[i] /= n;
    return re;
}
function _rfftfreq(size, d) {
    const h = Math.floor(size / 2) + 1, val = 1.0 / (size * d);
    const f = new Float64Array(h);
    for (let i = 0; i < h; i++) f[i] = i * val;
    return f;
}

/** A filter via FFT: gain(freqs) -> an amplitude response.
 *  circular=true - circular convolution (for seamless music loops). */
export function spectral(x, gain, pad = 0.25, circular = false) {
    const m = x.length;
    const size = circular ? m : fast_len(m + Math.trunc(m * pad) + 256);
    const X = _rfft(x, size);
    const f = _rfftfreq(size, 1.0 / SR);
    const y = _irfft(X.mul(gain(f)), size);
    return y.length === m ? y : y.slice(0, m);
}

export function lp(fc, order = 2) {
    return f => _map(f.length, i => 1.0 / Math.sqrt(1.0 + (f[i] / fc) ** (2 * order)));
}

export function hp(fc, order = 2) {
    return f => _map(f.length, i => 1.0 / Math.sqrt(1.0 + (fc / Math.max(f[i], 1e-3)) ** (2 * order)));
}

/** A band around fc about bw octaves wide (Gaussian in the logarithm of the frequency). */
export function bp(fc, bw = 1.0) {
    return f => _map(f.length, i => Math.exp(-((Math.log2(Math.max(f[i], 1.0) / fc) / (bw * 0.6)) ** 2)));
}

export function band(lo, hi, order = 2) {
    const a = hp(lo, order), b = lp(hi, order);
    return f => _mul(a(f), b(f));
}

/** A sum of resonances [[frequency, width in octaves, gain]] - a "vowel". */
export function formant(peaks) {
    const g = f => {
        const out = new Float64Array(f.length);
        for (const [fc, bw, k] of peaks) {
            for (let i = 0; i < f.length; i++) out[i] += k * Math.exp(-((Math.log2(Math.max(f[i], 1.0) / fc) / (bw * 0.6)) ** 2));
        }
        return out;
    };
    return g;
}

// ============================================================ sources
export function noise(n, r) {
    return _normal(r, n);
}

/** 'Brown' noise - dull, for rumble. */
export function brown(n, r) {
    const x = spectral(_normal(r, n), f => _map(f.length, i => 1.0 / Math.max(f[i], 20.0)));
    const k = _absmax(x) + 1e-9;
    for (let i = 0; i < x.length; i++) x[i] = x[i] / k;
    return x;
}

/** Phase for a constant (number) or varying (Float64Array) frequency. */
export function phase_of(freq, n) {
    if (typeof freq === 'number') {
        const k = TAU * freq;
        return _map(n, i => k * (i / SR));
    }
    const out = new Float64Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) { s += freq[i]; out[i] = TAU * s / SR; }
    return out;
}

/** An additive tone: sum a_k*sin(k*phi). bright - the power to which the envelope
 *  enters the upper harmonics (louder -> brighter, like brass). */
export function harmonic(freq, n, amps, env = null, bright = null) {
    const ph = phase_of(freq, n);
    let f0;
    if (typeof freq === 'number') f0 = freq;
    else { f0 = -Infinity; for (let i = 0; i < freq.length; i++) if (freq[i] > f0) f0 = freq[i]; }
    const out = new Float64Array(n);
    for (let k = 1; k <= amps.length; k++) {
        const a = amps[k - 1];
        if (a === 0 || k * f0 > SR * 0.45) continue;
        if (env != null && bright) {
            const p = bright * (k - 1);
            for (let i = 0; i < n; i++) out[i] += a * Math.sin(k * ph[i]) * env[i] ** p;
        } else {
            for (let i = 0; i < n; i++) out[i] += a * Math.sin(k * ph[i]);
        }
    }
    if (env == null) return out;
    for (let i = 0; i < n; i++) out[i] *= env[i];
    return out;
}

/** A frequency sliding exponentially from f_from to f_to (tau - seconds). */
export function glide(f_from, f_to, n, tau) {
    return _map(n, i => f_to + (f_from - f_to) * Math.exp(-(i / SR) / tau));
}

// ============================================================ space
export function reverb_ir(dur, seed, damp = 3500.0, pre = 0.012) {
    const r = rng(seed);
    const n = n_of(dur);
    const z = _normal(r, n);
    let ir = _map(n, i => z[i] * Math.exp(-(i / SR) * 6.9 / dur));
    ir = spectral(ir, lp(damp, 1));
    ir.fill(0, 0, Math.min(n, n_of(pre)));
    let s = 0;
    for (let i = 0; i < n; i++) s += ir[i] ** 2;
    const k = Math.sqrt(s + 1e-12);
    for (let i = 0; i < n; i++) ir[i] = ir[i] / k;
    return ir;
}

/** Mono -> stereo (n, 2) with reverb; for loops - circular convolution. */
export function reverb(x, dur = 1.2, wet = 0.2, seed = 7, circular = false, damp = 3500.0) {
    const g = _reverb_gen(x, dur, wet, seed, circular, damp);
    let r;
    while (!(r = g.next()).done) { /* synchronous */ }
    return r.value;
}

/** reverb() as a generator (yields between blocks, for async drivers).
 *  Python: irfft(rfft(x, size) * rfft(ir, size), size) - a linear convolution when size >= m + len(ir) - 1
 *  (not circular), a circular one of period m when size == m. Here the same convolution is computed by
 *  overlap-add with power-of-two FFTs (identical up to float rounding), so a long music loop is not one
 *  multi-second FFT. */
export function* _reverb_gen(x, dur = 1.2, wet = 0.2, seed = 7, circular = false, damp = 3500.0) {
    const m = x.length;
    const size = circular ? m : fast_len(m + n_of(dur) + 256);
    const irs = [seed, seed + 1].map(s => reverb_ir(Math.min(dur, size / SR * 0.9), s, damp));
    const L = irs[0].length;
    const outLen = circular ? m : m + n_of(dur);
    const out = [new Float64Array(outLen), new Float64Array(outLen)];
    let F = 1;
    while (F < 2 * L) F *= 2;
    F = Math.max(F, 4096);
    const B = F - L + 1;                        // input block: B + L - 1 <= F -> no wrap inside the block
    const H = irs.map(h => {
        const re = new Float64Array(F), im = new Float64Array(F);
        re.set(h);
        _rt_fft(re, im, false);
        return [re, im];
    });
    for (let b0 = 0; b0 < m; b0 += B) {
        const nb = Math.min(B, m - b0);
        const xr = new Float64Array(F), xi = new Float64Array(F);
        xr.set(x.subarray(b0, b0 + nb));
        _rt_fft(xr, xi, false);
        for (let c = 0; c < 2; c++) {
            const [hr, hi] = H[c];
            const yr = new Float64Array(F), yi = new Float64Array(F);
            for (let k = 0; k < F; k++) {
                yr[k] = xr[k] * hr[k] - xi[k] * hi[k];
                yi[k] = xr[k] * hi[k] + xi[k] * hr[k];
            }
            _rt_fft(yr, yi, true);
            const o = out[c], cnt = nb + L - 1;
            for (let k = 0; k < cnt; k++) {
                let j = b0 + k;
                if (circular) { while (j >= m) j -= m; } else if (j >= outLen) break;
                o[j] += yr[k] / F;
            }
        }
        yield;
    }
    const st = _stereo(outLen);
    const d = st.data, a = out[0], b = out[1];
    for (let i = 0; i < outLen; i++) {
        const dry = i < m ? x[i] : 0;
        d[2 * i] = dry + wet * a[i];
        d[2 * i + 1] = dry + wet * b[i];
    }
    return st;
}

export function normalize(x, peak) {
    const mx = _absmax(x);
    return mx > 1e-9 ? _scale(x, peak / mx) : x;
}

/** Sum signals [[offset_sec, signal, volume]] into one mono buffer. */
export function mix(parts, n = null) {
    if (n == null) {
        n = -Infinity;
        for (const [off, s] of parts) n = Math.max(n, n_of(off) + s.length);
    }
    const out = new Float64Array(n);
    for (const [off, s, g] of parts) {
        const i = off > 0 ? n_of(off) : 0;
        const j = Math.min(n, i + s.length);
        for (let k = i; k < j; k++) out[k] += g * s[k - i];
    }
    return out;
}

// ============================================================ instruments
export const _memo = new Map();

/** A plucked string (lute/harp): harmonics with decreasing amplitudes and faster-decaying
 *  upper ones, a double course (two slightly detuned strings) and a pick "click". */
export function pluck(freq, dur, bright = 0.5, seed = 0) {
    const key = py.tkey(['pl', py.round(freq, 2), py.round(dur, 3), bright, seed]);
    const s = _memo.get(key);
    if (s != null) return s;
    const n = n_of(dur);
    const t = tvec(n);
    const r = rng(seed + Math.trunc(freq));
    const p = 0.14 + 0.06 * bright;
    const tau0 = 1.6 * (220.0 / freq) ** 0.35;
    let out = new Float64Array(n);
    for (let k = 1; k < 15; k++) {
        const fk = k * freq * Math.sqrt(1 + 0.00012 * k * k);
        if (fk > SR * 0.45) break;
        const a = Math.abs(Math.sin(Math.PI * k * p)) / k ** (1.7 - 0.7 * bright);
        const tk = tau0 / (1 + 0.45 * (k - 1) * (1.2 - bright));
        const ph = r.uniform(0, TAU);
        const w1 = TAU * fk, w2 = TAU * fk * 1.0015;
        for (let i = 0; i < n; i++) {
            const e = Math.exp(-t[i] / tk);
            out[i] += a * e * Math.sin(w1 * t[i] + ph);
            if (k <= 3) out[i] += 0.5 * a * e * Math.sin(w2 * t[i] + ph + 1.3);
        }
    }
    const na = n_of(0.003);
    const la = _linspace(0, 1, na);
    for (let i = 0; i < Math.min(na, n); i++) out[i] *= la[i];
    const nz = Math.min(n, n_of(0.02));
    const click = _mul(spectral(_normal(r, nz), bp(Math.min(freq * 6, 5000), 1.5)), perc(nz, 0.004));
    for (let i = 0; i < nz; i++) out[i] += 0.15 * click[i];
    out = tail(out, 0.04);
    _memo.set(key, out);
    return out;
}

/** A recorder: an almost pure tone with light 2nd-3rd harmonics, breath and a "chiff" in the attack. */
export function recorder(freq, dur, seed = 0, vib = true) {
    const key = py.tkey(['rec', py.round(freq, 2), py.round(dur, 3), seed, vib]);
    const s = _memo.get(key);
    if (s != null) return s;
    const n = n_of(dur + 0.06);
    const t = tvec(n);
    const r = rng(seed + Math.trunc(freq) * 3);
    const f = new Float64Array(n).fill(freq);
    if (vib && dur > 0.3) {
        const ph0 = r.uniform(0, TAU);
        for (let i = 0; i < n; i++) {
            const depth = Math.min(1, Math.max(0, (t[i] - 0.18) / 0.3)) * 0.0045;
            f[i] *= 1 + depth * Math.sin(TAU * 5.1 * t[i] + ph0);
        }
    }
    const ph = phase_of(f, n);
    const tone = _map(n, i => Math.sin(ph[i]) + 0.16 * Math.sin(2 * ph[i]) + 0.09 * Math.sin(3 * ph[i]) + 0.025 * Math.sin(4 * ph[i]));
    const breath = _mul(spectral(_normal(r, n), bp(freq * 2.2, 1.2)), 0.035);
    const env = ramp(n, 0.035, 0.07);
    const nz = Math.min(n, n_of(0.03));
    const chiff = new Float64Array(n);
    chiff.set(_mul(spectral(_normal(r, nz), bp(freq * 4, 1.0)), perc(nz, 0.008)));
    const out = _map(n, i => (tone[i] + breath[i]) * env[i] + 0.12 * chiff[i]);
    _memo.set(key, out);
    return out;
}

/** A brass wind (horn, fanfare): the harmonics brighten with loudness, a pitch scoop in the attack. */
export function brass(freq, dur, seed = 0, bright = 0.6, scoop = 0.03, vib = 0.004) {
    const n = n_of(dur + 0.12);
    const t = tvec(n);
    const r = rng(seed + Math.trunc(freq));
    let f = _map(n, i => freq * (1 - scoop * Math.exp(-t[i] / 0.035)));
    if (vib) {
        const ph0 = r.uniform(0, TAU);
        f = _map(n, i => f[i] * (1 + vib * Math.min(1, Math.max(0, (t[i] - 0.25) / 0.3)) * Math.sin(TAU * 4.6 * t[i] + ph0)));
    }
    const env = _map(n, i => 0.82 + 0.18 * Math.exp(-t[i] / 0.12));
    const rm = ramp(n, 0.05, 0.12);
    for (let i = 0; i < n; i++) env[i] = rm[i] * env[i];
    const amps = [];
    for (let k = 1; k < 16; k++) amps.push(1.0 / k ** 0.7);
    const out = harmonic(f, n, amps, env, bright * 0.35);
    const breath = spectral(_normal(r, n), bp(freq * 3, 1.5));
    for (let i = 0; i < n; i++) breath[i] = out[i] + breath[i] * env[i] * 0.03;
    return spectral(breath, lp(Math.min(3200, freq * 12), 2));
}

/** A bell/little bell: inharmonic partials, each with its own decay. */
export function bell(freq, dur, seed = 0, soft = 0.0) {
    const n = n_of(dur);
    const t = tvec(n);
    const r = rng(seed + Math.trunc(freq));
    const parts = [[0.5, 0.35, 1.0], [1.0, 1.0, 0.8], [1.19, 0.4, 0.55], [1.5, 0.3, 0.45],
        [2.0, 0.45, 0.35], [2.52, 0.2 * (1 - soft), 0.25], [3.01, 0.15 * (1 - soft), 0.18]];
    const out = new Float64Array(n);
    for (const [ratio, a, tk] of parts) {
        const fk = freq * ratio;
        if (fk < SR * 0.45) {
            const ph = r.uniform(0, TAU), d = tk * dur * 0.6, w = TAU * fk;
            for (let i = 0; i < n; i++) out[i] += a * Math.exp(-t[i] / d) * Math.sin(w * t[i] + ph);
        }
    }
    const na = n_of(0.002);
    const la = _linspace(0, 1, na);
    for (let i = 0; i < Math.min(na, n); i++) out[i] *= la[i];
    return tail(out, 0.05);
}

/** A bright metallophone (glockenspiel): 1 : 2.76 : 5.4. */
export function chime(freq, dur, seed = 0) {
    const n = n_of(dur);
    const t = tvec(n);
    const w1 = TAU * freq, w2 = TAU * freq * 2.76, w3 = TAU * freq * 5.4;
    const out = _map(n, i => Math.sin(w1 * t[i]) * Math.exp(-t[i] / (dur * 0.35))
        + 0.25 * Math.sin(w2 * t[i]) * Math.exp(-t[i] / (dur * 0.12))
        + 0.08 * Math.sin(w3 * t[i]) * Math.exp(-t[i] / (dur * 0.05)));
    const na = n_of(0.0015);
    const la = _linspace(0, 1, na);
    for (let i = 0; i < Math.min(na, n); i++) out[i] *= la[i];
    return tail(out, 0.03);
}

/** A tambourine/drum: a tone with a pitch decay + a muffled noise of the strike. */
export function drum(f_hi = 150.0, f_lo = 70.0, tau = 0.22, snap = 0.25, seed = 0, dur = null) {
    dur = dur || tau * 4;
    const n = n_of(dur);
    const r = rng(seed);
    const f = glide(f_hi, f_lo, n, 0.035);
    const ph = phase_of(f, n), pb = perc(n, tau, 0.001);
    const hit = _mul(spectral(_normal(r, n), band(200, 2200)), perc(n, 0.03, 0.0005));
    return tail(_map(n, i => Math.sin(ph[i]) * pb[i] + snap * hit[i]), 0.02);
}

/** Sleigh bells/cymbals: high noise in short bursts. */
export function jingle(dur = 0.25, seed = 0, n_hits = 3) {
    const n = n_of(dur);
    const r = rng(seed);
    const out = new Float64Array(n);
    for (let i = 0; i < n_hits; i++) {
        const off = n_of(i * 0.012 + r.uniform(0, 0.006));
        if (off >= n) break;
        const m = n - off;
        const z = _normal(r, m);
        const e = perc(m, 0.05 + 0.02 * r.random());
        const g = 1 - 0.25 * i;
        for (let k = 0; k < m; k++) out[off + k] += z[k] * e[k] * g;
    }
    return tail(spectral(out, band(5000, 11000, 2)), 0.02);
}

/** An indistinct "vocal" sound (hm/ha/uh) - not speech: a harmonic tone through resonances. */
export function voice(f0, n, vowel, breath = 0.08, seed = 0) {
    const r = rng(seed);
    const f = typeof f0 !== 'number' ? f0 : new Float64Array(n).fill(f0);
    let fmax = -Infinity;
    for (let i = 0; i < f.length; i++) if (f[i] > fmax) fmax = f[i];
    const kmax = Math.trunc(Math.min(40, SR * 0.4 / fmax));
    const amps = [];
    for (let k = 1; k <= kmax; k++) amps.push(1.0 / k ** 1.1);
    const src = harmonic(f, n, amps);
    const z = _normal(r, n);
    for (let i = 0; i < n; i++) src[i] += breath * z[i];
    return spectral(src, formant(vowel));
}

export const VOWELS = {
    'hm': [[260, 0.6, 1.0], [2200, 0.8, 0.06]],
    'uh': [[520, 0.6, 1.0], [1050, 0.6, 0.45], [2500, 0.8, 0.12]],
    'ha': [[750, 0.6, 1.0], [1200, 0.6, 0.6], [2600, 0.8, 0.15]],
    'oh': [[430, 0.5, 1.0], [820, 0.5, 0.5], [2500, 0.8, 0.08]],
    'eh': [[550, 0.5, 1.0], [1800, 0.5, 0.45], [2600, 0.7, 0.2]],
    'baa': [[700, 0.5, 1.0], [1300, 0.5, 0.7], [2700, 0.7, 0.3]],
};

/** float (n,) or (n, 2) -> int16 bytes (Uint8Array, little-endian) with interleaved channels for the mixer. */
export function to_pcm(x, channels = 2) {
    let n, cols, get;
    if (_is_stereo(x)) {
        n = x.shape[0]; cols = x.shape[1];
        const d = x.data, s0 = x.strides[0], s1 = x.strides[1], o = x.offset;
        get = (i, c) => d[o + i * s0 + c * s1];
    } else if (x instanceof np.NDArray) {
        n = x.shape[0]; cols = 1;
        const d = x.data, s0 = x.strides[0], o = x.offset;
        get = i => d[o + i * s0];
    } else {
        n = x.length; cols = 1;
        get = i => x[i];
    }
    let val;
    if (cols === channels) val = get;
    else if (channels === 1) val = i => { let s = 0; for (let c = 0; c < cols; c++) s += get(i, c); return s / cols; };
    else if (cols === 1) val = i => get(i, 0);
    else val = (i, c) => (c < 2 && c < cols ? get(i, c) : 0);
    const out = new Uint8Array(n * channels * 2);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < channels; c++) {
            const v = Math.min(1, Math.max(-1, val(i, c)));
            dv.setInt16((i * channels + c) * 2, Math.trunc(v * 32767), true);
        }
    }
    return out;
}

// ------------------------------------------------------------ WAV container (Python's `wave` module)
/** A WAV file (RIFF, PCM 16 bit) around interleaved int16 bytes: what wave.open(..., 'wb') writes. */
export function _rt_wav_write(pcm, channels, rate) {
    const out = new Uint8Array(44 + pcm.length + (pcm.length & 1));
    const dv = new DataView(out.buffer);
    const tag = (o, s) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF');
    dv.setUint32(4, 36 + pcm.length, true);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, channels, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * channels * 2, true);
    dv.setUint16(32, channels * 2, true);
    dv.setUint16(34, 16, true);
    tag(36, 'data');
    dv.setUint32(40, pcm.length, true);
    out.set(pcm, 44);
    return out;
}
/** wave.open(bytes) -> {nchannels, sampwidth, framerate, nframes}; throws (like wave.Error/EOFError) on bad data. */
export function _rt_wav_info(u8) {
    if (!u8 || u8.length < 12) throw new py.OSError('wave: file does not start with RIFF id');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const tag = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new py.OSError('wave: not a WAVE file');
    let pos = 12, fmt = null, data = null;
    while (pos + 8 <= u8.length) {
        const id = tag(pos), len = dv.getUint32(pos + 4, true);
        if (id === 'fmt ') fmt = { nchannels: dv.getUint16(pos + 10, true), framerate: dv.getUint32(pos + 12, true), sampwidth: dv.getUint16(pos + 22, true) / 8 };
        else if (id === 'data') data = len;
        pos += 8 + len + (len & 1);
    }
    if (!fmt || data == null) throw new py.OSError('wave: fmt/data chunk missing');
    return { ...fmt, nframes: Math.floor(data / (fmt.sampwidth * fmt.nchannels)) };
}
