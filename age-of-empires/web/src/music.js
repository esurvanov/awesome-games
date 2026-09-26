// port of game/music.py
// Procedural medieval music: original pieces composed by simple rules
// (dorian / mixolydian / aeolian modes, a drone, a plucked lute, a recorder, light percussion).
//
// Each piece is a seamless loop (note tails and reverb wrap around to the beginning) plus a
// short "war" layer (drums + a low rumble) whose length divides the piece's length exactly: both layers
// start at the same time and run in sync, while the war layer's volume follows the intensity of the fighting.
//
// Python renders in a background thread; here MusicPlayer renders in async steps (the render is a generator
// that yields between sections, driven by a setTimeout chain), and the ready loops are cached as WAV files in
// the browser storage (storage.HOME/music). Only used when there are no music files (the browser has them).
import * as py from '../runtime/py.js';
import { time } from '../runtime/py.js';
import * as np from '../runtime/np.js';
import * as storage from '../runtime/storage.js';
import * as S from './synth.js';

export const VERSION = 3;
export const CACHE_DIR = py.os.path.join(storage.HOME, 'music');

export const MODES = {
    'dorian': [0, 2, 3, 5, 7, 9, 10],
    'mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'aeolian': [0, 2, 3, 5, 7, 8, 10],
};
// chord sequences (scale degrees) for 4 bars for the parts of the form
export const PROGS = {
    'dorian': { 'A': [0, 6, 0, 3], 'A2': [0, 3, 6, 0], 'B': [2, 3, 6, 4], 'C': [3, 0, 6, 4] },
    'mixolydian': { 'A': [0, 6, 0, 4], 'A2': [0, 6, 3, 0], 'B': [3, 0, 3, 6], 'C': [5, 6, 3, 4] },
    'aeolian': { 'A': [0, 5, 6, 0], 'A2': [0, 3, 4, 0], 'B': [5, 2, 6, 4], 'C': [5, 6, 0, 4] },
};
// bar rhythms in "steps" (eighth notes)
export const RHYTHMS = {
    6: [[3, 3], [2, 1, 3], [2, 1, 2, 1], [3, 2, 1], [1, 1, 1, 3], [2, 1, 1, 1, 1]],
    8: [[2, 2, 2, 2], [3, 1, 2, 2], [2, 1, 1, 2, 2], [4, 2, 2], [2, 2, 4], [1, 1, 2, 2, 2], [3, 1, 4]],
};
export const CADENCE = { 6: [[3, 3], [2, 1, 3], [6]], 8: [[2, 2, 4], [4, 4], [2, 6], [8]] };
export const ARPS = {
    6: [[[0, 1], [4, 1], [7, 1], [9, 1], [7, 1], [4, 1]], [[0, 2], [4, 1], [7, 2], [4, 1]],
        [[0, 3], [7, 1], [4, 2]]],
    8: [[[0, 1], [4, 1], [7, 1], [4, 1], [9, 1], [4, 1], [7, 1], [4, 1]],
        [[0, 2], [4, 1], [7, 1], [0, 2], [4, 1], [7, 1]], [[0, 3], [4, 1], [7, 2], [4, 2]]],
};

// The pieces. bpm - for 6/8 in dotted-quarter beats, for 4/4 - in quarters.
export const PIECES = [
    { name: 'village', title: 'Village Morning', tonic: 62, mode: 'dorian', meter: 6, bpm: 66, seed: 11,
        form: ['A', 'A2', 'B', 'A2', 'C', 'A2'], lead: ['pluck', 'recorder'], perc: 'soft' },
    { name: 'fields', title: 'Fields by the Mill', tonic: 67, mode: 'mixolydian', meter: 8, bpm: 92, seed: 23,
        form: ['A', 'A2', 'B', 'A2'], lead: ['recorder', 'pluck'], perc: 'none' },
    { name: 'forest', title: 'Old Forest', tonic: 69, mode: 'aeolian', meter: 8, bpm: 74, seed: 37,
        form: ['A', 'A2', 'C', 'A2'], lead: ['pluck', 'recorder'], perc: 'none' },
    { name: 'fair', title: 'The Fair', tonic: 64, mode: 'dorian', meter: 6, bpm: 76, seed: 51,
        form: ['A', 'A2', 'B', 'A2', 'A', 'A2'], lead: ['recorder', 'pluck'], perc: 'light' },
];
export const MENU = { name: 'menu', title: 'Chronicles', tonic: 62, mode: 'aeolian', meter: 8, bpm: 68, seed: 5,
    form: ['A', 'A2', 'B', 'A2'], lead: ['recorder', 'recorder'], perc: 'none', war: false };
export const ALL = Object.fromEntries([...PIECES, MENU].map(p => [p['name'], p]));


// ============================================================ composition
export function deg_midi(tonic, mode, d) {
    const sc = MODES[mode];
    return tonic + 12 * Math.floor(d / 7) + sc[py.mod(d, 7)];
}

/** A 4-bar melody: [[step, duration, degree]]. Strong beats lean to chord tones,
 *  the motion is mostly stepwise, the phrase ends on the tonic (final) or a chord tone. */
export function compose_section(prog, meter, center, seed, final) {
    const r = np.random.default_rng(seed);
    const notes = [];
    let cur = center + Math.trunc(r.choice([-2, 0, 2]));
    for (let bar = 0; bar < prog.length; bar++) {
        const root = prog[bar];
        const chord = new Set([py.mod(root, 7), py.mod(root + 2, 7), py.mod(root + 4, 7)]);
        const last = bar === prog.length - 1;
        const opts = last ? CADENCE[meter] : RHYTHMS[meter];
        const pat = opts[Math.trunc(r.integers(opts.length))];
        let pos = 0;
        for (let i = 0; i < pat.length; i++) {
            const dur = pat[i];
            const strong = pos === 0 || pos === Math.floor(meter / 2);
            if (last && i === pat.length - 1) {
                let targets;
                if (final) targets = [center - 7, center, center + 7];
                else {
                    targets = [];
                    for (let d = center - 4; d < center + 6; d++) if (chord.has(py.mod(d, 7))) targets.push(d);
                }
                const c0 = cur;
                cur = py.min(targets, d => Math.abs(d - c0) + (py.mod(d, 7) === 0 ? 0 : 0.1));
            } else {
                const moves = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
                let w = [0.3, 0.5, 1.2, 3.0, 0.6, 3.0, 1.2, 0.5, 0.3];
                const cand = moves.map(m => cur + m);
                w = w.map((x, k) => x * Math.exp(-Math.abs(cand[k] - center) / 3.5));
                if (strong) w = w.map((x, k) => x * (chord.has(py.mod(cand[k], 7)) ? 3.0 : 0.5));
                w = w.map((x, k) => ((cand[k] < center - 6) || (cand[k] > center + 7) ? 0 : x));
                let tot = 0;
                for (const x of w) tot += x;
                cur = Math.trunc(r.choice(cand, null, true, w.map(x => x / tot)));
            }
            notes.push([bar * meter + pos, dur, cur]);
            pos += dur;
        }
    }
    return notes;
}


// ============================================================ rendering
/** A stereo buffer of the loop with circular addition (tails wrap around to the beginning).
 *  buf is an np.NDArray (n, 2) float64 (interleaved data). */
export class Track {
    constructor(n) {
        this.n = n;
        this.buf = S._stereo(n);
    }

    put(sig, start, gain = 1.0, pan = 0.0) {
        const a = (pan + 1) * Math.PI / 4;
        const gl = gain * Math.cos(a) * 1.414, gr = gain * Math.sin(a) * 1.414;
        let i = py.mod(Math.trunc(start), this.n);
        const d = this.buf.data;
        let s0 = 0;
        const len = sig.length;
        while (s0 < len) {
            const m = Math.min(len - s0, this.n - i);
            for (let k = 0; k < m; k++) {
                const v = sig[s0 + k], o = (i + k) * 2;
                d[o] += gl * v;
                d[o + 1] += gr * v;
            }
            s0 += m;
            i = 0;
        }
    }
}

/** A drone (like a hurdy-gurdy): a sawtooth spectrum, a whole number of periods per segment n/reps -
 *  the segment is replicated, the loop's seam has no click; a slow volume "breathing" once per segment. */
export function loop_drone(freqs, n, gain, reps, seed) {
    const full = n;
    n = Math.floor(n / reps);
    const secs = n / S.SR;
    const t = S.tvec(n);
    const r = np.random.default_rng(seed);
    const out = new Float64Array(n);
    for (const f of freqs) {
        for (const det of [0.0, 0.0025]) {
            const fa = py.round(f * (1 + det) * secs) / secs;
            const ph0 = r.uniform(0, S.TAU);
            const ph = S._map(n, i => S.TAU * fa * t[i] + ph0);
            for (let k = 1; k < 12; k++) {
                const fk = k * fa;
                if (fk < 2500) {       // a soft "filter" right in the harmonics' amplitudes
                    const q = k ** 1.15, den = Math.sqrt(1 + (fk / 700) ** 4);
                    for (let i = 0; i < n; i++) out[i] += Math.sin(k * ph[i]) / q / den;
                }
            }
        }
    }
    for (let i = 0; i < n; i++) out[i] *= 0.8 + 0.2 * Math.sin(S.TAU * t[i] / secs);
    const seg = S.normalize(out, gain);
    const res = new Float64Array(full);
    for (let i = 0; i < full; i++) res[i] = seg[i % n];
    return res;
}

function _drive(gen) {
    let r;
    while (!(r = gen.next()).done) { /* synchronous: ignore the yields */ }
    return r.value;
}

/** Mono (n,) of a stereo (n, 2): tr.buf.mean(axis=1). */
function _mean2(st) {
    const n = st.shape[0], d = st.data, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (d[2 * i] + d[2 * i + 1]) / 2;
    return out;
}
/** buf + (wet - stack([mono, mono], axis=1)) -> new stereo. */
function _add_wet(buf, wet, mono) {
    const n = buf.shape[0], out = S._stereo(n), a = buf.data, w = wet.data, o = out.data;
    for (let i = 0; i < n; i++) {
        o[2 * i] = a[2 * i] + (w[2 * i] - mono[i]);
        o[2 * i + 1] = a[2 * i + 1] + (w[2 * i + 1] - mono[i]);
    }
    return out;
}

/** -> [base (n,2), war (m,2) or null, seconds in the loop]. */
export function render(spec) {
    return _drive(_render_gen(spec));
}

/** render() as a generator: yields between sections so an async driver can spread the work over frames. */
export function* _render_gen(spec) {
    const meter = spec['meter'], tonic = spec['tonic'], mode = spec['mode'];
    const step = 60.0 / spec['bpm'] / (meter === 6 ? 3 : 2);
    const sn = Math.max(1, py.round(step * S.SR / 64)) * 64;      // a multiple of 64: fast FFTs and an even roll
    const spb = meter;
    const form = spec['form'];
    const bars = 4 * form.length;
    const n = bars * spb * sn;
    const tr = new Track(n);
    const seed = spec['seed'];
    const rr = np.random.default_rng(seed);
    const center = 3;
    const melodies = {};
    for (const sec of new Set(form)) {
        let so = 0;
        for (const ch of sec) so += ch.codePointAt(0);
        melodies[sec] = compose_section(PROGS[mode][sec], meter, center + (['B', 'C'].includes(sec) ? 2 : 0),
            seed * 31 + so, ['A2'].includes(sec));
    }
    const seen = {};
    for (let si = 0; si < form.length; si++) {
        const sec = form[si];
        yield;
        const base_step = si * 4 * spb;
        const rep = py.get(seen, sec, 0);
        seen[sec] = rep + 1;
        const inst = spec['lead'][Math.floor(si / 2) % 2];
        // melody
        for (const [st, dur, d] of melodies[sec]) {
            const m = deg_midi(tonic, mode, d);
            const f = S.midi_hz(m);
            const secs = dur * step;
            const pos = (base_step + st) * sn;
            if (inst === 'pluck') {
                tr.put(S.pluck(f, Math.min(2.4, secs + 1.2), 0.55, seed), pos, 0.42, -0.25);
            } else {
                const ln = secs * 0.93;
                if (rep && dur >= 3 && rr.random() < 0.4) {      // ornament: a grace note from above
                    const g = S.midi_hz(deg_midi(tonic, mode, d + 1));
                    const gl = 0.07;
                    tr.put(S.recorder(g, gl, seed, false), pos, 0.24, 0.25);
                    tr.put(S.recorder(f, ln - gl, seed), pos + S.n_of(gl), 0.3, 0.25);
                } else {
                    tr.put(S.recorder(f, ln, seed), pos, 0.3, 0.25);
                }
            }
            if (rep && inst === 'recorder' && dur >= 2) {         // on the repeat the lute accompanies an octave lower
                tr.put(S.pluck(S.midi_hz(m - 12), Math.min(2.0, secs + 0.8), 0.4, seed + 1), pos, 0.16, -0.3);
            }
        }
        // accompaniment
        const prog = PROGS[mode][sec];
        for (let bar = 0; bar < prog.length; bar++) {
            const root = prog[bar];
            const pat = ARPS[meter][Math.trunc(rr.integers(ARPS[meter].length))];
            let p = 0;
            for (const [off, dur] of pat) {
                const m = deg_midi(tonic, mode, root + off - 7);
                tr.put(S.pluck(S.midi_hz(m), 1.4, 0.3, seed + 2), (base_step + bar * spb + p) * sn,
                    p ? 0.2 : 0.26, -0.45 + 0.1 * (off % 3));
                p += dur;
            }
        }
        // quiet percussion of the peaceful layer
        if (spec['perc'] !== 'none') {
            for (let bar = 0; bar < 4; bar++) {
                const b0 = (base_step + bar * spb) * sn;
                tr.put(S.drum(110, 65, 0.22, 0.15, seed + bar), b0, 0.2, 0.0);
                tr.put(S.drum(140, 90, 0.12, 0.2, seed + bar + 9), b0 + Math.floor(spb / 2) * sn, 0.1, 0.1);
                if (spec['perc'] === 'light') {
                    for (let k = 1; k < spb; k += 2) tr.put(S.jingle(0.2, seed + k, 2), b0 + k * sn, 0.05, 0.3);
                }
            }
        }
    }
    yield;
    // drone: tonic + fifth in the bass
    const drone = loop_drone([S.midi_hz(tonic - 24), S.midi_hz(tonic - 17)], n, 0.15, Math.floor(bars / 2), seed);
    const bd = tr.buf.data;
    for (let i = 0; i < n; i++) { bd[2 * i] += drone[i]; bd[2 * i + 1] += drone[i]; }
    const mono = _mean2(tr.buf);
    yield;
    const wet = yield* S._reverb_gen(mono, 1.6, 0.28, seed, true);
    const base = _add_wet(tr.buf, wet, mono);
    let war = null;
    if (py.get(spec, 'war', true)) {
        yield;
        war = yield* _render_war_gen(spec, sn, spb);
    }
    // overall scale: base and base+war without clipping
    let peak = S._absmax(base);
    if (war != null) {
        const m = war.shape[0], wd = war.data, b = base.data;
        let pk = -Infinity;
        for (let i = 0; i < n; i++) {
            const j = i % m;
            const l = Math.abs(b[2 * i] + wd[2 * j]), r = Math.abs(b[2 * i + 1] + wd[2 * j + 1]);
            if (l > pk) pk = l;
            if (r > pk) pk = r;
        }
        peak = Math.max(peak, pk);
    }
    const k = 0.85 / Math.max(peak, 1e-9);
    return [S._scale(base, k), (war != null ? S._scale(war, k) : null), n / S.SR];
}

/** The war layer: 2 bars of drums with a roll at the end + a low droning horn on the tonic. */
export function render_war(spec, sn, spb) {
    return _drive(_render_war_gen(spec, sn, spb));
}

export function* _render_war_gen(spec, sn, spb) {
    const n = 2 * spb * sn;
    const tr = new Track(n);
    const seed = spec['seed'] + 100;
    const hits = { 6: [[0, 1.0], [2, 0.5], [3, 0.8], [5, 0.5]], 8: [[0, 1.0], [2, 0.5], [3, 0.45], [4, 0.9], [6, 0.5]] };
    for (let bar = 0; bar < 2; bar++) {
        const b0 = bar * spb * sn;
        for (const [st, acc] of hits[spb]) {
            const big = st === 0;
            const d = big ? S.drum(95, 48, 0.32, 0.3, seed + st) : S.drum(190, 120, 0.1, 0.45, seed + st + 7);
            tr.put(d, b0 + st * sn, big ? 0.55 * acc : 0.32 * acc, big ? 0.0 : 0.15);
        }
        for (let k = 0; k < spb; k++) {
            if (k % 2) tr.put(S.jingle(0.18, seed + k, 2), b0 + k * sn, 0.05, -0.2);
        }
    }
    // a roll at the end of the second bar
    for (let i = 0; i < 4; i++) {
        tr.put(S.drum(210, 140, 0.07, 0.5, seed + 40 + i), (2 * spb - 1) * sn + Math.floor(i * sn / 4), 0.16 + 0.05 * i, 0.1);
    }
    yield;
    const horn = S.brass(S.midi_hz(spec['tonic'] - 24), n / S.SR - 0.2, seed, 0.4, 0.02, 0.003);
    const ls = S._linspace(0, Math.PI, horn.length);
    tr.put(S._map(horn.length, i => horn[i] * Math.sin(ls[i]) ** 1.5), 0, 0.1, 0.0);
    const fifth = S.brass(S.midi_hz(spec['tonic'] - 17), n / S.SR * 0.5, seed + 3, 0.3, 0.02, 0.003);
    const lf = S._linspace(0, Math.PI, fifth.length);
    tr.put(S._map(fifth.length, i => fifth[i] * Math.sin(lf[i])), spb * sn, 0.06, 0.2);
    const mono = _mean2(tr.buf);
    yield;
    const wet = yield* S._reverb_gen(mono, 1.0, 0.18, seed, true);
    return _add_wet(tr.buf, wet, mono);
}


// ============================================================ WAV
export function wav_bytes(x) {
    return S._rt_wav_write(S.to_pcm(x, 2), 2, S.SR);
}

export function cache_path(name, layer) {
    return py.os.path.join(CACHE_DIR, `${name}-${layer}-v${VERSION}-${S.SR}.wav`);
}

/** -> {'base': wav bytes, 'war': wav bytes | null, 'secs': loop length, 'gen': seconds to render}. */
export function load_or_render(name) {
    return _drive(_load_or_render_gen(name));
}

/** load_or_render() in async steps (a macrotask between render steps: the frame loop keeps running). */
export async function _load_or_render_async(name) {
    const gen = _load_or_render_gen(name);
    let r;
    while (!(r = gen.next()).done) await new Promise(res => setTimeout(res, 0));
    return r.value;
}

export function* _load_or_render_gen(name) {
    const spec = ALL[name];
    const paths = { base: cache_path(name, 'base'), war: cache_path(name, 'war') };
    const need_war = py.get(spec, 'war', true);
    try {
        if (storage.exists(paths['base']) && (!need_war || storage.exists(paths['war']))) {
            const base = storage.read_bytes(paths['base']);
            let war = null;
            if (need_war) war = storage.read_bytes(paths['war']);
            const wf = S._rt_wav_info(base);
            const secs = wf.nframes / wf.framerate;
            return { 'base': base, 'war': war, 'secs': secs, 'gen': 0.0 };
        }
    } catch (e) {
        if (!(e instanceof py.OSError)) throw e;
    }
    const t0 = time.perf_counter();
    const [b, w, secs] = yield* _render_gen(spec);
    const out = { 'base': wav_bytes(b), 'war': w != null ? wav_bytes(w) : null, 'secs': secs,
        'gen': time.perf_counter() - t0 };
    try {
        storage.makedirs(CACHE_DIR);
        for (const ly of ['base', 'war']) {
            if (out[ly] != null) {
                const tmp = paths[ly] + '.tmp';
                storage.write_bytes(tmp, out[ly]);
                storage.replace(tmp, paths[ly]);
            }
        }
    } catch (e) {
        if (!(e instanceof py.OSError)) throw e;
    }
    return out;
}


// ============================================================ player
/** Two pairs of reserved channels (base + war) for crossfading the pieces.
 *  Pieces are prepared in async steps; until the needed one is ready - the previous one plays (or silence). */
export class MusicPlayer {
    constructor(pg, channels) {
        this.pg = pg;
        this.chs = channels;                 // [[base, war], [base, war]]
        this.ready = {};                     // name → [Sound, Sound|null, secs] | null
        this.want = [];                      // queue for preparation
        this.lock = null;                    // (threading.Lock: not needed, one JS thread)
        this.thread = null;                  // the running async worker (a Promise) or null
        this.cur = null;                     // name of the playing piece
        this.pair = 0;
        this.started = 0.0;
        this.mode = null;
        this.order = PIECES.map(p => p['name']);
        this.idx = -1;
        this.war = 0.0;
        this.volume = 0.45;
        this.enabled = true;
        this.hold = false;                   // silence (after the end of the match), until the mode changes
        this.gen_times = {};
        this.lvl = [0.0, 0.0];
        this.tgt = [0.0, 0.0];
    }

    // ---- background preparation
    request(name) {
        if (Object.hasOwn(this.ready, name) || this.want.includes(name)) return;
        this.want.push(name);
        if (this.thread == null) {
            this.thread = this._work();
        }
    }

    async _work() {
        await null;          // the worker starts after request() returns (like a new thread)
        while (true) {
            if (!this.want.length) {
                this.thread = null;
                return;
            }
            const name = this.want[0];
            try {
                const d = await _load_or_render_async(name);
                const base = new this.pg.mixer.Sound(d['base']);
                const war = d['war'] ? new this.pg.mixer.Sound(d['war']) : null;
                this.gen_times[name] = d['gen'];
                this.ready[name] = [base, war, d['secs']];
            } catch (e) {           // no music, but the game continues
                this.ready[name] = null;
            }
            this.want.shift();
        }
    }

    // ---- control
    /** Menu -> then all pieces in turn: while the player is in the menu (the CPU is free), the loops
     *  manage to render into the cache, and in a match the preparation no longer competes with the game. */
    prefetch() {
        for (const name of ['menu', ...this.order]) this.request(name);
    }

    next_piece() {
        this.idx = (this.idx + 1) % this.order.length;
        return this.order[this.idx];
    }

    /** Start a piece on a free pair of channels; the previous pair fades out smoothly (we drive
     *  the volume ourselves every frame - SDL's built-in fades conflict with set_volume). */
    start(name) {
        const item = py.get(this.ready, name, null);
        if (!item) return false;
        const [base, war, secs] = item;
        this.tgt[this.pair] = 0.0;
        this.pair ^= 1;
        const [cb, cw] = this.chs[this.pair];
        this.lvl[this.pair] = 0.0;
        this.tgt[this.pair] = 1.0;
        cb.play(base, -1);
        cb.set_volume(0.0);
        if (war != null) cw.play(war, -1);
        else cw.stop();
        cw.set_volume(0.0);
        this.cur = name;
        this.started = time.monotonic();
        this.secs = secs;
        return true;
    }

    stop(fade = 1.5) {
        this.tgt = [0.0, 0.0];
        this.fade = fade;
        this.cur = null;
    }

    /** End of the match: the music fades until the return to the menu. */
    silence() {
        this.stop(1.2);
        this.hold = true;
    }

    update(mode, dt, intensity) {
        if (mode !== this.mode) {
            this.mode = mode;
            this.hold = false;
            this.pending = mode === 'menu' ? 'menu' : this.next_piece();
            if (this.cur != null) this.stop(1.5);
        }
        if (!this.enabled || this.hold) {
            if (this.cur != null) this.stop(0.8);
        } else {
            if (this.cur == null && this.pending == null) {
                this.pending = this.mode === 'menu' ? 'menu' : this.next_piece();
            } else if (this.mode === 'play' && this.pending == null &&
                    time.monotonic() - this.started > Math.max(75.0, this.secs) - 1.0) {
                this.pending = this.next_piece();
            }
            if (this.pending != null) {
                this.request(this.pending);
                if (Object.hasOwn(this.ready, this.pending)) {
                    if (this.ready[this.pending] == null || this.start(this.pending)) {
                        this.pending = null;
                        this.fade = 2.5;
                        if (this.mode === 'play') {         // prepare the next one in advance
                            this.request(this.order[(this.idx + 1) % this.order.length]);
                        }
                    }
                }
            }
        }
        // the war layer follows the intensity (rises quickly, falls slowly)
        const target = Math.min(1.0, intensity);
        const k = 1 - Math.exp(-dt / (target > this.war ? 0.8 : 6.0));
        this.war += (target - this.war) * k;
        const step = dt / Math.max(0.05, this.fade);
        for (let i = 0; i < this.chs.length; i++) {
            const [cb, cw] = this.chs[i];
            let lv = this.lvl[i];
            lv = this.tgt[i] > lv ? Math.min(this.tgt[i], lv + step) : Math.max(this.tgt[i], lv - step);
            this.lvl[i] = lv;
            if (lv <= 0 && this.tgt[i] <= 0) {
                if (cb.get_busy()) {
                    cb.stop();
                    cw.stop();
                }
                continue;
            }
            const g = lv * lv * this.volume;
            cb.set_volume(g * (1 - 0.15 * this.war));
            cw.set_volume(g * 0.9 * this.war);
        }
    }
}
py.classattrs(MusicPlayer, { pending: null, secs: 60.0, fade: 2.5 });
