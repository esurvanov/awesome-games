// port of game/sound.py
// Sound: recorded effects and music from 0 A.D. (assets/audio, CC BY-SA 3.0), procedural ones - as a replacement,
// positioning by the camera, fog of war, rate limiting.
//
// Interface (ui.Game):
//   sound.pre_init()               - before pygame.init()
//   this.audio = new sound.Audio() - after
//   this.audio.handle(e)           - keys M / N, the speaker icon and the volume window (true - the event was consumed)
//   this.audio.update(this, dt)    - every frame: world events (game.events) -> sounds, music by mode
//   this.audio.draw_popup(scr)     - over the frame: the volume window (if open)
// Files are loaded asynchronously (the `sfx` asset group); without files the sounds and music are procedural.
// Everything is silently disabled if there is no audio device.
import * as py from '../runtime/py.js';
import { random, time, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as assets from '../runtime/assets.js';
import * as storage from '../runtime/storage.js';
import { SCREEN_W, SCREEN_H, TOP_H, PANEL_H, UNITS, BUILDINGS } from './data.js';
import * as S from './synth.js';
import * as music from './music.js';

export const SETTINGS = py.os.path.join(storage.HOME, 'settings.json');

// ------------------------------------------------------------ small array helpers (numpy expressions)
const _map = S._map, _mul = S._mul;
function _sin(a) { return _map(a.length, i => Math.sin(a[i])); }
function _dec(t, tk) { return _map(t.length, i => Math.exp(-t[i] / tk)); }
function _clip01(v) { return Math.min(1, Math.max(0, v)); }
function _in(d, k) { return k != null && Object.hasOwn(d, k); }
function _dget(d, k, dflt) { return _in(d, k) ? d[k] : dflt; }


// ============================================================ effects (mono, float)
export function _clang(v) {
    const r = S.rng(100 + v);
    const f = [660, 780, 900, 720][v % 4] * r.uniform(0.97, 1.03);
    const n = S.n_of(0.42);
    const t = S.tvec(n);
    const metal = new Float64Array(n);
    for (const [ratio, a, tk] of [[1, 1.0, 0.2], [1.51, 0.55, 0.13], [2.76, 0.4, 0.08], [3.93, 0.2, 0.05], [5.4, 0.1, 0.03]]) {
        const ph = r.uniform(0, S.TAU), w = S.TAU * f * ratio;
        for (let i = 0; i < n; i++) metal[i] += a * Math.exp(-t[i] / tk) * Math.sin(w * t[i] + ph);
    }
    const click = _mul(S.spectral(S._normal(r, n), S.band(1500, 6000)), S.perc(n, 0.006, 0.0005));
    const thud = _mul(_sin(S.phase_of(S.glide(160, 90, n, 0.03), n)), S.perc(n, 0.05));
    let x = _map(n, i => 0.45 * metal[i] + 0.5 * click[i] + 0.6 * thud[i]);
    if (v % 2) {                                      // a second, weaker blow (a blade on a shield)
        const p8 = S.perc(n, 0.08);
        x = S.mix([[0, x, 1.0], [0.055, _map(n, i => 0.5 * metal[i] * p8[i]), 0.8]], n);
    }
    return S.spectral(x, S.lp(6500, 2));
}

export function _arrow_hit(v) {
    const r = S.rng(200 + v);
    const n = S.n_of(0.2);
    const body = _mul(_sin(S.phase_of(S.glide(240, 115, n, 0.02), n)), S.perc(n, 0.045));
    const knock = _mul(S.spectral(S._normal(r, n), S.bp(900 + 200 * v, 1.2)), S.perc(n, 0.02, 0.0005));
    return _map(n, i => 0.8 * body[i] + 0.6 * knock[i]);
}

export function _siege_hit(v) {
    const r = S.rng(300 + v);
    const n = S.n_of(1.0);
    const boom = _mul(_sin(S.phase_of(S.glide(95, 36, n, 0.12), n)), S.perc(n, 0.25));
    const rumble = _mul(S.spectral(S.brown(n, r), S.lp(450)), S.perc(n, 0.3, 0.005));
    const crack = _mul(S.spectral(S._normal(r, n), S.bp(1400, 1.5)), S.perc(n, 0.025, 0.0005));
    return S.tail(_map(n, i => boom[i] + 0.9 * rumble[i] + 0.5 * crack[i]), 0.1);
}

export function _thud(v) {
    const r = S.rng(400 + v);
    const n = S.n_of(0.16);
    const a = _mul(S.spectral(S._normal(r, n), S.lp(700)), S.perc(n, 0.035, 0.001));
    const b = _mul(_sin(S.phase_of(S.glide(150, 90, n, 0.02), n)), S.perc(n, 0.05));
    return _map(n, i => a[i] + 0.7 * b[i]);
}

export function _wood(freqs, taus, n, r, noise_f = 1800, noise_g = 0.35) {
    const t = S.tvec(n);
    const x = new Float64Array(n);
    for (let j = 0; j < Math.min(freqs.length, taus.length); j++) {
        const f = freqs[j], tk = taus[j];
        const ph = r.uniform(0, S.TAU), w = S.TAU * f;
        for (let i = 0; i < n; i++) x[i] += Math.exp(-t[i] / tk) * Math.sin(w * t[i] + ph);
    }
    const nz = _mul(S.spectral(S._normal(r, n), S.bp(noise_f, 1.3)), S.perc(n, 0.006, 0.0003));
    for (let i = 0; i < n; i++) x[i] += noise_g * nz[i];
    const na = S.n_of(0.001);
    const l = S._linspace(0, 1, na);
    for (let i = 0; i < Math.min(na, n); i++) x[i] *= l[i];
    return x;
}

export function _hit_bld(v) {
    const r = S.rng(500 + v);
    const k = [1.0, 0.9, 1.1][v % 3];
    return S.tail(_wood([170 * k, 390 * k, 660 * k], [0.08, 0.05, 0.03], S.n_of(0.3), r, 900), 0.03);
}

export function _arrow(v) {
    const r = S.rng(600 + v);
    const n = S.n_of(0.32);
    const t = S.tvec(n);
    const env = _map(n, i => Math.sin(Math.PI * _clip01(t[i] / 0.3)) ** 2 * Math.exp(-t[i] / 0.2));
    const whoosh = _mul(S.spectral(S._normal(r, n), S.bp(1300 + 250 * v, 1.4)), env);
    const pl = S.pluck(140 + 15 * v, 0.3, 0.2, v);
    const t3 = S.tvec(S.n_of(0.3));
    const tw = _map(pl.length, i => pl[i] * Math.exp(-t3[i] / 0.06));     // bowstring
    return S.mix([[0, tw, 0.8], [0.015, whoosh, 0.5]], n);
}

export function _grunt(v) {
    const n = S.n_of(0.38);
    const f0 = [140, 115, 165, 125][v % 4];
    const g = S.glide(f0 * 1.15, f0 * 0.72, n, 0.18), t = S.tvec(n);
    const f = _map(n, i => g[i] * (1 + 0.02 * Math.sin(S.TAU * 23 * t[i])));
    const vow = ['uh', 'oh', 'eh', 'uh'][v % 4];
    const x = S.voice(f, n, S.VOWELS[vow], 0.18, 700 + v);
    const e1 = S.ramp(n, 0.015, 0.2), e2 = S.perc(n, 0.22);
    return S.tail(_map(n, i => x[i] * e1[i] * e2[i]), 0.02);
}

export function _neigh(v) {
    const n = S.n_of(0.9);
    const t = S.tvec(n);
    const g = S.glide(330, 520, n, 0.12);
    const base = _map(n, i => g[i] * (t[i] > 0.25 ? Math.exp(-(t[i] - 0.25) / 0.5) : 1.0));
    const f = _map(n, i => Math.max(base[i], 260) * (1 + 0.07 * Math.sin(S.TAU * 11 * t[i]) * _clip01(t[i] / 0.2)));
    const x = S.voice(f, n, S.VOWELS['eh'], 0.35, 800 + v);
    return S.tail(_mul(x, S.ramp(n, 0.03, 0.3)), 0.03);
}

export function _baa(v) {
    const n = S.n_of(0.55);
    const t = S.tvec(n);
    const g = S.glide(1.08, 1.0, n, 0.08);
    const f = _map(n, i => (310 + 30 * v) * (1 + 0.05 * Math.sin(S.TAU * 7.5 * t[i])) * g[i]);
    const x = S.voice(f, n, S.VOWELS['baa'], 0.12, 900 + v);
    return S.tail(_mul(x, S.ramp(n, 0.04, 0.2)), 0.02);
}

export function _animal(v) {
    const n = S.n_of(0.35);
    const f = S.glide(230 + 40 * v, 120, n, 0.12);
    const x = S.voice(f, n, S.VOWELS['oh'], 0.3, 950 + v);
    return S.tail(_mul(x, S.ramp(n, 0.01, 0.2)), 0.02);
}

export function _destroy(v) {
    const r = S.rng(1000 + v);
    const n = S.n_of(1.8);
    const t = S.tvec(n);
    const rumble = _mul(S.spectral(S.brown(n, r), S.lp(600)), S.perc(n, 0.55, 0.01));
    const boom = _mul(_sin(S.phase_of(S.glide(70, 32, n, 0.2), n)), S.perc(n, 0.35));
    let x = _map(n, i => rumble[i] + 0.8 * boom[i]);
    for (let q = 0; q < 14; q++) {                  // the crack of breaking beams
        const off = r.uniform(0, 0.9) ** 1.5;
        const m = S.n_of(0.12);
        const c = _wood([r.uniform(250, 600), r.uniform(700, 1500)], [0.04, 0.02], m, r, r.uniform(900, 2500), 0.9);
        x = S.mix([[0, x, 1.0], [off, c, 0.25 * Math.exp(-off * 1.5)]], n);
    }
    for (let q = 0; q < 4; q++) {                   // falling debris
        const off = r.uniform(0.5, 1.3);
        x = S.mix([[0, x, 1.0], [off, _thud(Math.trunc(r.integers(9))), 0.25]], n);
    }
    return S.tail(_map(n, i => x[i] * (1 - 0.3 * _clip01(t[i] - 1.2))), 0.2);
}

export function _chop(v) {
    const r = S.rng(1100 + v);
    const k = [1.0, 0.93, 1.07][v % 3];
    return S.tail(_wood([330 * k, 760 * k, 1210 * k], [0.05, 0.03, 0.02], S.n_of(0.18), r, 2200), 0.02);
}

export function _mine(v) {
    const r = S.rng(1200 + v);
    const n = S.n_of(0.26);
    const t = S.tvec(n);
    const f = [2100, 2350, 1950][v % 3];
    const ping = new Float64Array(n);
    for (const [q, a, tk] of [[1, 1.0, 0.07], [2.43, 0.4, 0.035], [3.9, 0.2, 0.02]]) {
        const w = S.TAU * f * q;
        for (let i = 0; i < n; i++) ping[i] += a * Math.exp(-t[i] / tk) * Math.sin(w * t[i]);
    }
    const crunch = _mul(S.spectral(S._normal(r, n), S.bp(1100, 1.5)), S.perc(n, 0.02, 0.0005));
    return S.tail(_map(n, i => 0.4 * ping[i] + 0.8 * crunch[i]), 0.02);
}

export function _rustle(v, lo = 2200, hi = 7000, dur = 0.34, grains = 6) {
    const r = S.rng(1300 + v);
    const n = S.n_of(dur);
    const env = new Float64Array(n);
    const t = S.tvec(n);
    for (let q = 0; q < grains; q++) {
        const c = r.uniform(0.02, dur - 0.06);
        const g = _map(n, i => Math.exp(-(((t[i] - c) / 0.025) ** 2)));
        const k = r.uniform(0.4, 1.0);
        for (let i = 0; i < n; i++) env[i] += g[i] * k;
    }
    return S.tail(_mul(S.spectral(S._normal(r, n), S.band(lo, hi)), env), 0.02);
}

export function _butcher(v) {
    const r = S.rng(1400 + v);
    const n = S.n_of(0.18);
    const a = _mul(S.spectral(S._normal(r, n), S.lp(500)), S.perc(n, 0.045, 0.002));
    const b = _mul(S.spectral(S._normal(r, n), S.bp(900, 1)), S.perc(n, 0.02));
    return _map(n, i => a[i] + 0.3 * b[i]);
}

export function _hammer(v) {
    const r = S.rng(1500 + v);
    const k = [1.0, 1.06, 0.95][v % 3];
    const n = S.n_of(0.16);
    const t = S.tvec(n);
    const pt = S.perc(n, 0.012);
    const tick = _map(n, i => Math.sin(S.TAU * 3200 * k * t[i]) * pt[i]);
    const w = _wood([520 * k, 1150 * k], [0.04, 0.025], n, r, 2800, 0.5);
    return S.tail(_map(n, i => w[i] + 0.25 * tick[i]), 0.02);
}

export function _place(v) {
    const r = S.rng(1600 + v);
    const a = _wood([200, 470], [0.06, 0.03], S.n_of(0.2), r, 1200);
    return S.mix([[0, a, 1.0], [0.1, a, 0.7]]);
}

export function _mono(st) {
    if (!S._is_stereo(st)) return st;
    const n = st.shape[0], d = st.data, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (d[2 * i] + d[2 * i + 1]) / 2;
    return out;
}

export function _build_done(v) {
    const notes = [74, 78, 81, 86];                           // a D major triad upward
    const parts = notes.map((m, i) => [i * 0.09, S.bell(S.midi_hz(m), 1.4, i, 0.5), 0.8 - 0.1 * i]);
    return S.reverb(S.mix(parts), 1.2, 0.25, 11);
}

export function _train_done(v) {
    const parts = [[0, S.pluck(S.midi_hz(67), 0.9, 0.7, 1), 0.9], [0.11, S.pluck(S.midi_hz(74), 1.0, 0.7, 2), 1.0],
        [0.11, S.chime(S.midi_hz(86), 0.6), 0.25]];
    return S.reverb(S.mix(parts), 1.0, 0.18, 12);
}

export function _tech_done(v) {
    const notes = [76, 81, 85, 88];
    const parts = notes.map((m, i) => [i * 0.075, S.chime(S.midi_hz(m), 1.1), 0.7]);
    parts.push([0.3, S.bell(S.midi_hz(69), 1.6, 3, 0.7), 0.5]);
    return S.reverb(S.mix(parts), 1.4, 0.3, 13);
}

/** A fanfare: a trumpet melody + a second trumpet (a third/fifth below) + timpani. -> [parts, end time] */
export function _fanfare(line, harm, tempo, seed, drums = true) {
    const parts = [];
    let t = 0.0;
    for (let i = 0; i < Math.min(line.length, harm.length); i++) {
        const [m, d] = line[i], h = harm[i];
        const dur = d * tempo;
        parts.push([t, S.brass(S.midi_hz(m), dur * 0.9, seed, 0.6), 0.55]);
        if (h) parts.push([t, S.brass(S.midi_hz(h), dur * 0.9, seed + 1, 0.6), 0.35]);
        if (drums && d >= 1) parts.push([t, S.drum(90, 55, 0.35, 0.25, seed), 0.5]);
        t += dur;
    }
    return [parts, t];
}

export function _age_up(v) {
    const line = [[62, 0.5], [62, 0.5], [69, 1], [66, 0.5], [69, 0.5], [74, 3]];
    const harm = [57, 57, 62, 62, 66, 69];
    const [parts, end] = _fanfare(line, harm, 0.3, 21);
    for (let i = 0; i < 10; i++) {                     // a timpani roll under the last note
        parts.push([end - 0.9 + i * 0.05, S.drum(110, 70, 0.1, 0.3, i), 0.15 + 0.03 * i]);
    }
    parts.push([end - 0.9, S.jingle(0.6, 5, 5), 0.12]);
    parts.push([end - 0.9, S.bell(S.midi_hz(74), 2.0, 4, 0.4), 0.3]);
    return S.reverb(S.mix(parts), 1.8, 0.3, 14);
}

export function _age_other(v) {
    const [parts] = _fanfare([[57, 1], [62, 2.5]], [50, 57], 0.3, 22, false);
    return S.reverb(S.mix(parts), 1.6, 0.35, 15);
}

/** A war horn: a low note with a run-up, a short + a long signal. */
export function _alert(v) {
    const f = S.midi_hz(43);
    const a = S.brass(f, 0.4, 31, 1.0, 0.08, 0.0);
    let b = S.brass(f, 1.2, 32, 1.0, 0.06, 0.003);
    const nb = b.length;
    const tb = S.tvec(nb);
    b = _map(nb, i => b[i] * (1 - 0.02 * _clip01((tb[i] - 1.0) / 0.3)));
    const lo = S.brass(f / 2, 1.2, 33, 0.5, 0.05, 0.0);
    let x = S.mix([[0, a, 1.0], [0.55, b, 1.0], [0.55, lo, 0.35]]);
    x = S.spectral(x, S.lp(1600, 2));
    return S.reverb(x, 2.0, 0.35, 16);
}

export function _click(v) {
    const n = S.n_of(0.06);
    const t = S.tvec(n);
    const p1 = S.perc(n, 0.008), p2 = S.perc(n, 0.015);
    return _map(n, i => Math.sin(S.TAU * 1500 * t[i]) * p1[i] + 0.8 * Math.sin(S.TAU * 380 * t[i]) * p2[i]);
}

export function _hm(f0, rise, dur, vowel = 'hm', seed = 0) {
    const n = S.n_of(dur);
    const f = rise !== 1 ? S.glide(f0, f0 * rise, n, dur * 0.6) : f0;
    const x = S.voice(f, n, S.VOWELS[vowel], 0.05, seed);
    return S.tail(_mul(x, S.ramp(n, 0.02, dur * 0.45)), 0.01);
}

export function _sel_vil(v) {
    return _hm([150, 185, 220, 165][v % 4], 1.12, 0.24, 'hm', 1700 + v);
}

export function _shing(f = 1850, dur = 0.35, seed = 0) {
    const n = S.n_of(dur);
    const t = S.tvec(n);
    const r = S.rng(seed);
    const x = new Float64Array(n);
    for (const [q, a, tk] of [[1, 1, 0.12], [1.49, 0.5, 0.08], [2.61, 0.25, 0.05]]) {
        const ph = r.uniform(0, 6), w = S.TAU * f * q;
        for (let i = 0; i < n; i++) x[i] += a * Math.exp(-t[i] / tk) * Math.sin(w * t[i] + ph);
    }
    const na = S.n_of(0.01);
    const l = S._linspace(0, 1, na);
    for (let i = 0; i < Math.min(na, n); i++) x[i] *= l[i];
    return x;
}

export function _sel_inf(v) {
    return S.mix([[0, _hm([120, 105, 135][v % 3], 0.95, 0.16, 'ha', 1800 + v), 1.0],
        [0.02, _shing(1700 + 150 * v, 0.3, v), 0.25]]);
}

export function _sel_arch(v) {
    const pl = S.pluck(165 + 20 * v, 0.35, 0.25, v);
    const t = S.tvec(S.n_of(0.35));
    const tw = _map(pl.length, i => pl[i] * Math.exp(-t[i] / 0.1));
    return S.mix([[0, tw, 1.0], [0.05, S.recorder(S.midi_hz(76 + 2 * v), 0.1, v, false), 0.35]]);
}

export function _snort(v) {
    const r = S.rng(1900 + v);
    const n = S.n_of(0.3);
    const t = S.tvec(n);
    const env = _map(n, i => Math.exp(-(((t[i] - 0.05) / 0.03) ** 2)) + 0.8 * Math.exp(-(((t[i] - 0.16) / 0.045) ** 2)));
    const x = _mul(S.spectral(S._normal(r, n), S.formant([[600, 1.2, 1.0], [1400, 1.0, 0.4]])), env);
    return S.tail(x, 0.02);
}

export function _hoof(v, n_steps = 3) {
    const r = S.rng(2000 + v);
    const parts = [];
    for (let i = 0; i < n_steps; i++) {
        parts.push([i * 0.085, _wood([300, 820], [0.03, 0.015], S.n_of(0.08), r, 1500, 0.5), 1 - 0.15 * i]);
    }
    return S.mix(parts);
}

export function _sel_cav(v) {
    return S.mix([[0, _snort(v), 1.0], [0.2, _hoof(v, 2), 0.4]]);
}

export function _creak(v, dur = 0.35) {
    const r = S.rng(2100 + v);
    const n = S.n_of(dur);
    const t = S.tvec(n);
    const ph0 = r.uniform(0, 6);
    const wob = S.spectral(S._normal(r, n), S.lp(15));
    const f = _map(n, i => Math.max(260 + 90 * Math.sin(S.TAU * 2.2 * t[i] + ph0) + 30 * wob[i], 60));
    const pulses = _sin(S.phase_of(f, n));
    let x = _map(n, i => Math.sign(pulses[i]) * Math.abs(pulses[i]) ** 0.3);
    x = _mul(S.spectral(x, S.bp(900, 1.6)), S.ramp(n, 0.03, 0.1));
    return S.tail(x, 0.02);
}

export function _sel_siege(v) {
    const r = S.rng(2200 + v);
    return S.mix([[0, _creak(v), 0.8], [0.18, _wood([140, 330], [0.08, 0.04], S.n_of(0.25), r, 700), 0.7]]);
}

export function _sel_bell(v) {
    return S.reverb(S.bell(S.midi_hz(72), 1.2, 7, 0.6), 1.0, 0.2, 17);
}

export function _sel_anvil(v) {
    return S.mix([[0, _shing(1500, 0.5, 40), 1.0], [0, _shing(2250, 0.3, 41), 0.3]]);
}

export function _sel_wood(v) {
    const r = S.rng(2300 + v);
    return _wood([260, 620], [0.05, 0.03], S.n_of(0.2), r, 1500);
}

export function _sel_horn(v) {
    const [parts] = _fanfare([[55, 1.2]], [null], 0.3, 24, false);
    return S.mix(parts);
}

export function _cmd_vil(v) {
    const a = [160, 190, 140][v % 3];
    return S.mix([[0, _hm(a, 1.0, 0.1, 'hm', 2400 + v), 1.0], [0.11, _hm(a * 1.2, 1.05, 0.14, 'hm', 2410 + v), 0.9]]);
}

export function _cmd_inf(v) {
    return _hm([125, 110, 140][v % 3], 0.85, 0.14, 'ha', 2500 + v);
}

export function _cmd_arch(v) {
    const m = [74, 76, 72][v % 3];
    return S.mix([[0, S.recorder(S.midi_hz(m), 0.08, v, false), 1.0],
        [0.09, S.recorder(S.midi_hz(m + 5), 0.12, v, false), 1.0]]);
}

export function _cmd_cav(v) {
    return _hoof(v + 5, 3);
}

export function _cmd_siege(v) {
    return _creak(v + 3, 0.25);
}

export function _cmd_attack(v) {
    const m = [50, 52, 48][v % 3];
    return S.mix([[0, S.brass(S.midi_hz(m), 0.16, 26 + v, 1.0, 0.06, 0), 0.8],
        [0, S.brass(S.midi_hz(m + 7), 0.16, 27 + v, 1.0, 0.06, 0), 0.5]]);
}

export function _victory(v) {
    const line = [[67, 0.5], [71, 0.5], [74, 1], [72, 0.5], [74, 0.5], [79, 1], [77, 0.5], [79, 0.5], [79, 4]];
    const harm = [62, 67, 67, 67, 71, 74, 74, 74, 71];
    const [parts, end] = _fanfare(line, harm, 0.28, 41);
    parts.push([end - 1.1, S.jingle(0.8, 6, 6), 0.12]);
    [67, 71, 74, 79].forEach((m, i) => {
        parts.push([end - 1.1 + i * 0.08, S.bell(S.midi_hz(m + 12), 2.2, i, 0.5), 0.25]);
    });
    return S.reverb(S.mix(parts), 2.2, 0.35, 18);
}

export function _defeat(v) {
    const line = [[57, 1], [55, 1], [53, 1], [52, 1.5], [50, 4]];
    const harm = [50, 48, 46, 45, 45];
    const [parts, end] = _fanfare(line, harm, 0.42, 42, false);
    for (let i = 0; i < 3; i++) parts.push([i * 0.84, S.drum(80, 45, 0.45, 0.2, i), 0.6]);
    parts.push([end - 1.7, S.drum(70, 40, 0.6, 0.2, 9), 0.7]);
    const x = S.spectral(S.mix(parts), S.lp(2200, 2));
    return S.reverb(x, 2.5, 0.4, 19);
}

export function _defeat_other(v) {
    let parts = [[0, S.drum(80, 45, 0.4, 0.2, 1), 0.7], [0.3, S.drum(80, 45, 0.4, 0.2, 2), 0.6]];
    const [p2] = _fanfare([[45, 3]], [38], 0.35, 43, false);
    parts = parts.concat(p2.map(([o, s, g]) => [0.3 + o, s, g * 0.8]));
    return S.reverb(S.spectral(S.mix(parts), S.lp(1500, 2)), 1.8, 0.35, 20);
}


// ---- garrison, town bell, building upgrades
/** A heavy door slammed: a dull wooden thud + the click of a bolt. */
export function _door(v) {
    const r = S.rng(2600 + v);
    const k = [1.0, 0.92, 1.08][v % 3];
    const n = S.n_of(0.32);
    const thud = _wood([95 * k, 210 * k, 430 * k], [0.09, 0.05, 0.025], n, r, 700, 0.6);
    const low = _mul(_sin(S.phase_of(S.glide(120 * k, 70 * k, n, 0.04), n)), S.perc(n, 0.07));
    const latch = _wood([1900 * k, 3100 * k], [0.012, 0.008], S.n_of(0.05), r, 3500, 0.4);
    return S.tail(S.mix([[0, _map(n, i => thud[i] + 0.7 * low[i]), 1.0], [0.13, latch, 0.35]], n), 0.02);
}

/** Leaving a building: a door creak, then the tramp of several feet. */
export function _eject(v) {
    const r = S.rng(2700 + v);
    const parts = [[0, _creak(v + 11, 0.3), 0.45], [0.22, _door(v), 0.6]];
    for (let i = 0; i < 4; i++) {
        const m = S.n_of(0.07);
        const step = _mul(S.spectral(S._normal(r, m), S.lp(900)), S.perc(m, 0.018, 0.001));
        parts.push([0.36 + i * 0.09 + r.uniform(0, 0.03), step, 0.5 - 0.06 * i]);
    }
    return S.tail(S.mix(parts), 0.02);
}

/** Town bell: a big bell and a smaller one ring alternately ("bam-bom") three times. */
export function _town_bell(v) {
    const lo = S.midi_hz(50), hi = S.midi_hz(55);         // D and G of the small octave - a heavy brass ring
    const parts = [];
    for (let i = 0; i < 6; i++) {
        const f = i % 2 === 0 ? lo : hi;
        const g = i % 2 === 0 ? 0.95 : 0.75;
        parts.push([i * 0.42, S.bell(f, 2.6, 60 + i, 0.15), g * (1 - 0.05 * i)]);
        // the clapper's strike - a short metallic click in the attack
        const m = S.n_of(0.03);
        const clk = _mul(S.spectral(S._normal(S.rng(70 + i), m), S.bp(2600, 1.2)), S.perc(m, 0.005));
        parts.push([i * 0.42, clk, 0.25]);
    }
    const x = S.spectral(S.mix(parts), S.lp(5000, 2));
    return S.reverb(x, 2.4, 0.35, 61);
}

/** Rebuilding a fortification: blows on stone and a bright ring of completion. */
export function _upgrade(v) {
    const r = S.rng(2800 + v);
    const parts = [];
    for (let i = 0; i < 3; i++) {
        const m = S.n_of(0.2);
        const stone = _mul(S.spectral(S._normal(r, m), S.bp(1300 + 300 * i, 1.2)), S.perc(m, 0.02, 0.0005));
        parts.push([i * 0.14, stone, 0.8]);
        parts.push([i * 0.14, _shing(2400 + 180 * i, 0.18, 80 + i), 0.18]);
    }
    [72, 76, 79].forEach((m, i) => {
        parts.push([0.45 + i * 0.07, S.chime(S.midi_hz(m + 12), 0.8), 0.35]);
    });
    return S.reverb(S.mix(parts), 1.0, 0.2, 62);
}


// ---- market and trade
/** One coin: a short "ding" from inharmonic partials. */
export function _coin(r, f = null) {
    f = f || r.uniform(3300, 4800);
    const n = S.n_of(0.14);
    const t = S.tvec(n);
    const x = new Float64Array(n);
    for (const [q, a, tk] of [[1, 1.0, 0.05], [1.58, 0.6, 0.035], [2.31, 0.35, 0.02], [0.53, 0.25, 0.03]]) {
        const ph = r.uniform(0, 6), w = S.TAU * f * q;
        for (let i = 0; i < n; i++) x[i] += a * Math.exp(-t[i] / tk) * Math.sin(w * t[i] + ph);
    }
    const na = S.n_of(0.0008);
    const l = S._linspace(0, 1, na);
    for (let i = 0; i < Math.min(na, n); i++) x[i] *= l[i];
    return x;
}

export function _coins(v, n_coins = 4, spread = 0.22, seed = 2900, purse = true) {
    const r = S.rng(seed + v);
    const parts = [];
    for (let i = 0; i < n_coins; i++) {
        parts.push([r.uniform(0, spread) + i * 0.02, _coin(r), r.uniform(0.5, 1.0)]);
    }
    if (purse) {                                          // a purse landed on the counter
        const m = S.n_of(0.12);
        const bag = _mul(S.spectral(S._normal(r, m), S.lp(600)), S.perc(m, 0.03, 0.002));
        parts.push([0, bag, 0.8]);
    }
    return S.tail(S.mix(parts), 0.02);
}

export function _market(v) {
    return _coins(v, 4 + v, 0.18);
}

/** Tribute: coins pour, at the end - a bright chord of little bells. */
export function _tribute(v) {
    const parts = [[0, _coins(v, 12, 0.6, 3000, true), 1.0]];
    [79, 83, 86].forEach((m, i) => {
        parts.push([0.55 + i * 0.06, S.chime(S.midi_hz(m), 0.7), 0.3]);
    });
    return S.reverb(S.mix(parts), 0.9, 0.15, 63);
}

/** A cart came home: the creak of wheels, a knock and the ring of the takings. */
export function _trade(v) {
    const r = S.rng(3100 + v);
    const parts = [[0, _creak(v + 20, 0.45), 0.5],
        [0.3, _wood([120, 280], [0.07, 0.04], S.n_of(0.2), r, 700), 0.6],
        [0.42, _coins(v + 5, 5, 0.25, 3150, false), 0.8]];
    return S.tail(S.mix(parts), 0.02);
}

/** Farm reseeding: a shovel into the ground and the rustle of grain. */
export function _reseed(v) {
    const r = S.rng(3200 + v);
    const n = S.n_of(0.2);
    const dig = _mul(S.spectral(S._normal(r, n), S.lp(800)), S.perc(n, 0.05, 0.004));
    return S.mix([[0, dig, 1.0], [0.12, _rustle(v + 30, 1500, 5000, 0.3, 8), 0.5]]);
}


// ---- monks: an unearthly chord (its own sound - a "choir" on a vowel and a soft organ)
export function _choir(notes, dur, seed, vowel = 'oh', att = 0.5, rel = 0.6) {
    const parts = [];
    notes.forEach((m, i) => {
        const n = S.n_of(dur);
        const t = S.tvec(n);
        const hz = S.midi_hz(m);
        const f0 = _map(n, j => hz * (1 + 0.004 * Math.sin(S.TAU * (4.8 + 0.3 * i) * t[j] + i)));     // living vibrato
        let x = S.voice(f0, n, S.VOWELS[vowel], 0.04, seed + i);
        const k = S._absmax(x) + 1e-9;
        const org = _sin(S.phase_of(hz * 1.002, n));
        x = _map(n, j => x[j] / k + 0.5 * org[j]);
        parts.push([0, _mul(x, S.ramp(n, att, rel)), 1.0 / notes.length]);
    });
    return S.mix(parts);
}

/** A monk began converting: a quiet swelling cloud of voices (E minor with a ninth). */
export function _convert_start(v) {
    const notes = [[64, 71, 78, 67], [62, 69, 76, 65]][v % 2];
    const x = _choir(notes, 1.5, 3300 + 10 * v, 'oh', 1.0, 0.4);
    return S.reverb(S.spectral(x, S.lp(3000, 2)), 2.0, 0.4, 64);
}

/** The conversion is done: the chord opens into a bright major, with a ring on top. */
export function _convert(v) {
    const x = _choir([60, 67, 76, 79, 84], 2.0, 3400 + v, 'ha', 0.08, 1.2);
    const parts = [[0, S.spectral(x, S.lp(3800, 2)), 1.0]];
    [88, 91, 96].forEach((m, i) => {
        parts.push([0.05 + i * 0.09, S.chime(S.midi_hz(m), 1.2), 0.18]);
    });
    return S.reverb(S.mix(parts), 2.4, 0.45, 65);
}


// ---- siege, explosions
/** Packing/unpacking a trebuchet: a ratchet's clatter and the creak of the frame. */
export function _ratchet(v) {
    const r = S.rng(3500 + v);
    const parts = [];
    for (let i = 0; i < 9; i++) {
        const clk = _wood([900 + 60 * (i % 3), 2100], [0.015, 0.008], S.n_of(0.05), r, 2600, 0.6);
        parts.push([i * 0.075, clk, 0.6 + 0.05 * (i % 2)]);
    }
    parts.push([0.1, _creak(v + 40, 0.6), 0.35]);
    parts.push([0.72, _wood([140, 320], [0.08, 0.04], S.n_of(0.25), r, 800), 0.7]);
    return S.tail(S.mix(parts), 0.02);
}

/** A shell burst: a short blow, a rumble and a scatter of clods of earth. */
export function _blast(v) {
    const r = S.rng(3600 + v);
    const n = S.n_of(1.0);
    const boom = _mul(_sin(S.phase_of(S.glide(120, 40, n, 0.08), n)), S.perc(n, 0.18));
    const crack = _mul(S.spectral(S._normal(r, n), S.band(250, 2200)), S.perc(n, 0.035, 0.0005));
    const rumble = _mul(S.spectral(S.brown(n, r), S.lp(500)), S.perc(n, 0.28, 0.004));
    let x = _map(n, i => boom[i] + 0.35 * crack[i] + 1.0 * rumble[i]);
    for (let q = 0; q < 5; q++) {                                  // falling clods
        const off = r.uniform(0.18, 0.6);
        x = S.mix([[0, x, 1.0], [off, _thud(Math.trunc(r.integers(9))), 0.15]], n);
    }
    return S.tail(x, 0.1);
}

/** A fire ship's detonation: a big explosion, a splash and the hiss of water. */
export function _explode(v) {
    const r = S.rng(3700 + v);
    const n = S.n_of(2.0);
    const t = S.tvec(n);
    const boom = _mul(_sin(S.phase_of(S.glide(90, 28, n, 0.15), n)), S.perc(n, 0.4));
    const blast = _mul(S.spectral(S._normal(r, n), S.band(150, 2200)), S.perc(n, 0.09, 0.0005));
    const rumble = _mul(S.spectral(S.brown(n, r), S.lp(400)), S.perc(n, 0.6, 0.01));
    const env = _map(n, i => Math.exp(-(((t[i] - 0.35) / 0.25) ** 2)) + 0.6 * Math.exp(-t[i] / 0.9) * (t[i] > 0.3 ? 1 : 0));
    const splash = _mul(S.spectral(S._normal(r, n), S.band(700, 5000)), env);
    const x = _map(n, i => boom[i] + 0.5 * blast[i] + 1.0 * rumble[i] + 0.2 * splash[i]);
    return S.tail(_map(n, i => x[i] * (1 - 0.4 * _clip01(t[i] - 1.4))), 0.15);
}


// ---- ships
/** Steps on a gangplank: a dull knock on planks and a creak. */
export function _plank(v) {
    const r = S.rng(3800 + v);
    const k = [1.0, 0.9, 1.1][v % 3];
    const parts = [[0, _wood([110 * k, 240 * k, 520 * k], [0.08, 0.05, 0.025], S.n_of(0.3), r, 800, 0.5), 1.0],
        [0.16, _wood([130 * k, 300 * k], [0.06, 0.03], S.n_of(0.2), r, 900, 0.4), 0.6],
        [0.05, _creak(v + 50, 0.3), 0.2]];
    return S.tail(S.mix(parts), 0.02);
}

export function _splash(v, dur = 0.45, lo = 700, hi = 6000) {
    const r = S.rng(3900 + v);
    const n = S.n_of(dur);
    const t = S.tvec(n);
    const env = _map(n, i => Math.exp(-(((t[i] - 0.04) / 0.03) ** 2)) + 0.5 * Math.exp(-t[i] / (dur * 0.35)));
    const x = _mul(S.spectral(S._normal(r, n), S.band(lo, hi)), env);
    const bloop = _mul(_sin(S.phase_of(S.glide(260, 620, n, 0.05), n)), S.perc(n, 0.05));
    return S.tail(_map(n, i => x[i] + 0.4 * bloop[i]), 0.02);
}

/** Landing: the gangplank's boards, then a splash by the shore. */
export function _unload(v) {
    return S.mix([[0, _plank(v + 3), 1.0], [0.3, _splash(v, 0.4), 0.45]]);
}

/** A fishing ship: a net slaps the water. */
export function _fish(v) {
    return _splash(v + 5, 0.35, 900, 7000);
}


// name -> [builder, number of variants, peak level]
export const SFX = {
    'hit_melee': [_clang, 4, 0.55], 'hit_arrow': [_arrow_hit, 3, 0.5], 'hit_siege': [_siege_hit, 2, 0.8],
    'hit_thud': [_thud, 3, 0.45], 'hit_bld': [_hit_bld, 3, 0.55],
    'arrow': [_arrow, 3, 0.4],
    'death': [_grunt, 4, 0.5], 'death_horse': [_neigh, 2, 0.45], 'baa': [_baa, 2, 0.45], 'death_animal': [_animal, 2, 0.45],
    'destroy': [_destroy, 2, 0.8],
    'work_chop': [_chop, 3, 0.4], 'work_mine': [_mine, 3, 0.35], 'work_farm': [v => _rustle(v, 1200, 4500), 3, 0.22],
    'work_forage': [v => _rustle(v + 7, 1500, 5000, 0.26, 4), 3, 0.22], 'work_butcher': [_butcher, 3, 0.3],
    'work_build': [_hammer, 3, 0.45], 'place': [_place, 1, 0.5],
    'build_done': [_build_done, 1, 0.5], 'train_done': [_train_done, 1, 0.5], 'tech_done': [_tech_done, 1, 0.5],
    'age_up': [_age_up, 1, 0.8], 'age_other': [_age_other, 1, 0.5], 'alert': [_alert, 1, 0.85],
    'click': [_click, 1, 0.35],
    'sel_vil': [_sel_vil, 4, 0.35], 'sel_inf': [_sel_inf, 3, 0.5], 'sel_arch': [_sel_arch, 3, 0.5],
    'sel_cav': [_sel_cav, 3, 0.5], 'sel_siege': [_sel_siege, 2, 0.5],
    'sel_bell': [_sel_bell, 1, 0.45], 'sel_anvil': [_sel_anvil, 1, 0.35], 'sel_wood': [_sel_wood, 2, 0.4],
    'sel_horn': [_sel_horn, 1, 0.45],
    'cmd_vil': [_cmd_vil, 3, 0.35], 'cmd_inf': [_cmd_inf, 3, 0.45], 'cmd_arch': [_cmd_arch, 3, 0.3],
    'cmd_cav': [_cmd_cav, 2, 0.45], 'cmd_siege': [_cmd_siege, 2, 0.35], 'cmd_attack': [_cmd_attack, 3, 0.45],
    'victory': [_victory, 1, 0.85], 'defeat': [_defeat, 1, 0.85], 'defeat_other': [_defeat_other, 1, 0.6],
    // events that appeared after the sound system (garrison, market, monks, siege, navy)
    'garrison': [_door, 3, 0.5], 'eject': [_eject, 2, 0.5], 'bell': [_town_bell, 1, 0.8],
    'upgrade': [_upgrade, 1, 0.55], 'market': [_market, 3, 0.45], 'tribute': [_tribute, 1, 0.5],
    'trade': [_trade, 2, 0.5], 'reseed': [_reseed, 2, 0.35],
    'convert_start': [_convert_start, 2, 0.4], 'convert': [_convert, 1, 0.6],
    'pack': [_ratchet, 2, 0.45], 'blast': [_blast, 3, 0.75], 'explode': [_explode, 1, 0.85],
    'board': [_plank, 3, 0.45], 'unload': [_unload, 2, 0.5], 'work_fish': [_fish, 3, 0.25],
};


/** A ready effect signal (mono Float64Array or stereo NDArray (n, 2)), normalized to its own peak level. */
export function render_sfx(name, v) {
    const [fn, , peak] = SFX[name];
    const x0 = S.normalize(fn(v), peak);
    const st = S._is_stereo(x0);
    const len = S._len(x0);
    const d = st ? x0.data : x0;
    let last = -1;
    for (let i = 0; i < len; i++) {
        const e = st ? Math.max(Math.abs(d[2 * i]), Math.abs(d[2 * i + 1])) : Math.abs(d[i]);
        if (e > 0.002) last = i;
    }
    const end = last >= 0 ? Math.min(len, last + S.n_of(0.02)) : len;
    const nr = Math.min(end, S.n_of(0.02));                 // the reverb tail is faded without a click
    const ramp = S._linspace(1, 0, nr);
    if (st) {
        const out = S._stereo(end), o = out.data;
        o.set(d.subarray(0, end * 2));
        for (let i = 0; i < nr; i++) { const j = (end - nr + i) * 2; o[j] *= ramp[i]; o[j + 1] *= ramp[i]; }
        return out;
    }
    const x = d.slice(0, end);
    for (let i = 0; i < nr; i++) x[end - nr + i] *= ramp[i];
    return x;
}

export function wav_bytes(x, channels = 2) {
    return S._rt_wav_write(S.to_pcm(x, channels), channels, S.SR);
}


// ============================================================ recorded sounds (0 A.D.)
export const AUDIO_DIR = 'assets/audio';


/** assets/audio/manifest.json -> dict (or {} - then the sounds are procedural). */
export function load_manifest(base = null) {
    try {
        const m = assets.read_json(py.os.path.join(base || AUDIO_DIR, 'manifest.json'));
        return py.is_dict(m) ? m : {};
    } catch (e) {
        return {};
    }
}

// an exact sound name -> a more general one (the chain ends with a procedural effect from SFX):
// so if files are missing every event still has a voice
export const FALLBACK = {
    'hit_pierce': 'hit_melee', 'hit_shot': 'hit_arrow', 'hit_ram': 'hit_siege',
    'arrow_jav': 'arrow', 'arrow_gun': 'arrow', 'fire_bolt': 'arrow', 'fire_siege': 'arrow', 'fire_cannon': 'blast',
    'death_female': 'death', 'death_camel': 'death_horse', 'death_elephant': 'death_horse',
    'death_boar': 'death_animal', 'death_ship': 'destroy',
    'alert_city': 'alert', 'defeat_ally': 'defeat_other',
    'sel_vil_m': 'sel_vil', 'sel_vil_f': 'sel_vil', 'sel_mil': 'sel_inf', 'sel_camel': 'sel_cav',
    'sel_elephant': 'sel_cav', 'sel_ship': 'sel_wood', 'sel_sheep': 'baa', 'sel_boar': 'death_animal',
    'sel_tree': 'click', 'sel_stone': 'click', 'sel_gold': 'click', 'sel_berries': 'click',
    'cmd_move_m': 'cmd_inf', 'cmd_gather_m': 'cmd_inf', 'cmd_build_m': 'cmd_inf', 'cmd_garrison_m': 'cmd_inf',
    'cmd_heal_m': 'cmd_inf', 'cmd_attack_m': 'cmd_attack', 'cmd_attack_f': 'cmd_vil',
    'cmd_move_f': 'cmd_vil', 'cmd_gather_f': 'cmd_vil', 'cmd_build_f': 'cmd_vil', 'cmd_garrison_f': 'cmd_vil',
    'cmd_cav_attack': 'cmd_cav', 'cmd_elephant': 'cmd_cav', 'cmd_siege_attack': 'cmd_siege', 'cmd_ship': 'cmd_siege',
};
// building kind -> the suffix of the done_* / selb_* files
export const BKEY = { 'lumber_camp': 'camp', 'mining_camp': 'camp', 'guard_tower': 'tower', 'keep': 'tower',
    'palisade_wall': 'wall', 'stone_wall': 'wall', 'palisade_gate': 'gate' };
export const TRAIN = { 'vil': 'train_vil', 'inf': 'train_inf', 'arch': 'train_inf', 'siege': 'train_inf', 'cav': 'train_cav',
    'monk': 'train_monk', 'ship': 'train_ship' };
export const RES_SEL = { 'tree': 'sel_tree', 'gold': 'sel_gold', 'stone': 'sel_stone', 'berries': 'sel_berries' };


export function fallback_of(name) {
    if (_in(FALLBACK, name)) return FALLBACK[name];
    if (name.startsWith('done_')) return 'build_done';
    if (name.startsWith('train_') && name !== 'train_done') return 'train_done';
    if (name.startsWith('selb_')) return _dget(BUILDING_SEL, name.slice(5), 'sel_wood');
    return null;
}

export function bkey(kind, sel = false) {
    if (sel && kind === 'archery_range') {
        return 'barracks';            // 0 A.D. has no separate selection sound for the archery range
    }
    return _dget(BKEY, kind, kind);
}

/** All the names that Audio may request (to check coverage and the procedural replacement). -> Set */
export function runtime_names() {
    const names = new Set([...Object.keys(FALLBACK), ...Object.values(TRAIN), ...Object.values(RES_SEL)]);
    for (const k of Object.keys(BUILDINGS)) names.add('done_' + bkey(k));
    for (const k of Object.keys(BUILDINGS)) names.add('selb_' + bkey(k, true));
    for (const w of ['chop', 'mine', 'farm', 'forage', 'butcher', 'build', 'fish']) names.add('work_' + w);
    for (const s of ['hit_melee', 'hit_arrow', 'hit_siege', 'hit_thud', 'hit_bld', 'arrow', 'death', 'death_horse',
        'death_animal', 'baa', 'destroy', 'place', 'tech_done', 'age_up', 'age_other', 'alert', 'click',
        'victory', 'defeat', 'defeat_other', 'bell', 'garrison', 'eject', 'upgrade', 'market', 'tribute',
        'trade', 'reseed', 'convert_start', 'convert', 'pack', 'blast', 'explode', 'board', 'unload']) names.add(s);
    return names;
}


// ============================================================ playback rules
// group -> [minimum interval between starts, s; maximum simultaneous]
export const RULES = {
    'hit_melee': [0.07, 4], 'hit_arrow': [0.06, 3], 'hit_siege': [0.15, 2], 'hit_thud': [0.09, 2], 'hit_bld': [0.1, 2],
    'arrow': [0.08, 3], 'fire': [0.15, 2], 'death': [0.12, 3], 'destroy': [0.3, 2],
    'work_chop': [0.15, 2], 'work_mine': [0.15, 2], 'work_farm': [0.25, 2], 'work_forage': [0.25, 2],
    'work_butcher': [0.2, 2], 'work_build': [0.15, 2], 'place': [0.1, 1],
    'build_done': [0.4, 1], 'train_done': [0.25, 1], 'tech_done': [0.4, 1],
    'age_up': [1.0, 1], 'age_other': [2.0, 1], 'alert': [4.0, 1], 'click': [0.03, 2],
    'voice': [0.05, 1], 'jingle': [1.0, 1], 'defeat_other': [1.0, 1],
    'garrison': [0.15, 2], 'eject': [0.4, 1], 'bell': [3.0, 1], 'upgrade': [0.5, 1], 'market': [0.12, 2],
    'tribute': [0.5, 1], 'trade': [0.5, 2], 'reseed': [0.3, 1], 'convert_start': [0.6, 2], 'convert': [0.8, 1],
    'pack': [0.4, 2], 'blast': [0.12, 3], 'explode': [0.3, 2], 'board': [0.15, 2], 'unload': [0.5, 1],
    'work_fish': [0.3, 2],
};
export const GROUP = { 'victory': 'jingle', 'defeat': 'jingle', 'alert_city': 'alert', 'defeat_ally': 'defeat_other',
    'hit_pierce': 'hit_melee', 'hit_shot': 'hit_arrow', 'hit_ram': 'hit_siege',
    'arrow_jav': 'arrow', 'arrow_gun': 'arrow', 'fire_bolt': 'fire', 'fire_siege': 'fire', 'fire_cannon': 'fire' };
// sounds for which a new start cuts off the previous one (the "voice" of the selected squad)
export const REPLACE = new Set(['voice']);
export const BUILDING_SEL = { 'town_center': 'sel_bell', 'barracks': 'sel_inf', 'archery_range': 'sel_arch', 'stable': 'sel_cav',
    'blacksmith': 'sel_anvil', 'siege_workshop': 'sel_siege', 'castle': 'sel_horn', 'tower': 'sel_horn' };
export const CLS_KEY = { 'vil': 'vil', 'inf': 'inf', 'arch': 'arch', 'cav': 'cav', 'siege': 'siege' };
export const GLOBAL_GAIN = { 'alert': 0.9, 'age_up': 0.9, 'age_other': 0.55, 'victory': 1.0, 'defeat': 1.0, 'jingle': 1.0,
    'defeat_other': 0.7, 'build_done': 0.6, 'train_done': 0.55, 'tech_done': 0.6,
    'bell': 0.85, 'market': 0.6, 'tribute': 0.6, 'convert': 0.45 };
// volume of the recorded effects by group (the files were leveled to one loudness at build time -
// here is the balance among them: blows and work are quieter than notifications)
export const SAMPLE_GAIN = { 'hit_melee': 0.5, 'hit_arrow': 0.45, 'hit_siege': 0.75, 'hit_thud': 0.45, 'hit_bld': 0.45,
    'arrow': 0.35, 'fire': 0.6, 'death': 0.5, 'destroy': 0.85, 'blast': 0.7, 'explode': 0.85,
    'work_chop': 0.35, 'work_mine': 0.3, 'work_farm': 0.3, 'work_forage': 0.3, 'work_butcher': 0.3,
    'work_fish': 0.3, 'work_build': 0.35, 'place': 0.5, 'reseed': 0.4, 'voice': 0.7, 'click': 0.45,
    'garrison': 0.5, 'eject': 0.5, 'market': 0.55, 'trade': 0.5, 'pack': 0.5, 'board': 0.5,
    'unload': 0.5, 'convert_start': 0.45 };
// events with a place on the map: those of others in the fog of war are not heard
export const POSITIONAL = ['hit', 'death', 'destroy', 'arrow', 'work', 'place', 'garrison', 'eject', 'bell', 'upgrade', 'trade',
    'reseed', 'convert_start', 'convert', 'pack', 'blast', 'explode', 'board', 'unload'];


export function group_of(name) {
    if (py.startswith(name, ['sel_', 'cmd_', 'selb_'])) return 'voice';
    if (name.startsWith('death') || name === 'baa') return 'death';
    if (name.startsWith('done_')) return 'build_done';
    if (name.startsWith('train_')) return 'train_done';
    return _dget(GROUP, name, name);
}

/** A villager's gender for the voice and scream: constant per unit, ~40 % are female.
 *  (CPython's id() is an address, at least 64 bytes apart for these objects, so id // 64 walks the
 *  residues mod 5; py.id() is a counter - the same distribution is id % 5.) */
export function is_female(u) {
    return py.getattr(u, 'kind', null) === 'villager' && py.mod(py.id(u), 5) < 2;
}

/** Before pygame.init(): 44.1 kHz, 16 bit, stereo, a small buffer (latency ~23 ms). */
export function pre_init() {
    try {
        pygame.mixer.pre_init(44100, -16, 2, 1024);
    } catch (e) {
        // ignore
    }
}


export const DEFAULTS = { 'music': true, 'sfx': true, 'music_vol': 0.5, 'sfx_vol': 0.8, 'voice_vol': 0.8 };

/** Python float(x) for JSON values: TypeError for None/containers, ValueError for bad strings. */
function _float(x) {
    if (typeof x === 'number') return x;
    if (typeof x === 'boolean') return x ? 1.0 : 0.0;
    if (typeof x === 'string') return py.float(x);
    throw new py.TypeError('float() argument must be a string or a real number');
}
/** Python max(0.0, min(1.0, v)) (NaN-safe the same way: min/max keep the first on NaN). */
function _clamp01(v) {
    const a = v < 1.0 ? v : 1.0;
    return a > 0.0 ? a : 0.0;
}

export function load_settings() {
    let d = { ...DEFAULTS };
    try {
        const raw = JSON.parse(storage.read_text(SETTINGS));
        if (py.is_dict(raw)) Object.assign(d, raw);
        for (const k of ['music', 'sfx']) d[k] = py.bool(d[k]);
        for (const k of ['music_vol', 'sfx_vol', 'voice_vol']) d[k] = _clamp01(_float(d[k]));
    } catch (e) {
        d = { ...DEFAULTS };
    }
    return d;
}

export function save_settings(d) {
    try {
        let cur = {};
        try {
            cur = JSON.parse(storage.read_text(SETTINGS));          // we keep the other keys of the settings file
            if (!py.is_dict(cur)) cur = {};
        } catch (e) {
            cur = {};
        }
        for (const k of Object.keys(DEFAULTS)) if (_in(d, k)) cur[k] = d[k];
        storage.makedirs(py.os.path.dirname(SETTINGS));
        storage.write_text(SETTINGS, JSON.stringify(cur));
    } catch (e) {
        if (!(e instanceof py.OSError)) throw e;
    }
}


// ============================================================ volume window
export const POP_W = 214, POP_H = 80;
export const ON_C = [225, 210, 175], OFF_C = [120, 105, 85], RED = [220, 90, 70];

export function draw_speaker(scr, x, cy, on, c) {
    pygame.draw.rect(scr, c, [x + 1, cy - 3, 4, 7]);
    pygame.draw.polygon(scr, c, [[x + 5, cy - 3], [x + 10, cy - 8], [x + 10, cy + 8], [x + 5, cy + 3]]);
    if (on) {
        for (const rad of [5, 9]) {
            const pts = [-0.8, -0.4, 0, 0.4, 0.8].map(a => [x + 8 + rad * Math.cos(a), cy + rad * Math.sin(a)]);
            pygame.draw.lines(scr, c, false, pts, 2);
        }
    } else {
        pygame.draw.line(scr, RED, [x + 12, cy - 5], [x + 19, cy + 5], 2);
        pygame.draw.line(scr, RED, [x + 19, cy - 5], [x + 12, cy + 5], 2);
    }
}

export function draw_note(scr, nx, cy, on, c) {
    pygame.draw.circle(scr, c, [nx, cy + 5], 3);
    pygame.draw.line(scr, c, [nx + 2, cy + 5], [nx + 2, cy - 7], 2);
    pygame.draw.line(scr, c, [nx + 2, cy - 7], [nx + 8, cy - 4], 2);
    if (!on) pygame.draw.line(scr, RED, [nx - 5, cy + 8], [nx + 9, cy - 8], 2);
}


const _tick = () => new Promise(res => setTimeout(res, 0));

export class Audio {
    constructor() {
        this.settings = load_settings();
        // browser: another tab changed settings.json -> take its sound keys (music/sfx/volumes)
        if (storage.on_change) storage.on_change(p => { if (py.os.path.normpath(p) === py.os.path.normpath(SETTINGS)) this._sync_settings(); });
        this.ok = false;
        this.sfx = {};                 // name -> [Sound]
        this.gain = {};                // name -> a volume multiplier (recorded sounds)
        this.playing = {};             // group -> [[channel, sound]]
        this.last = {};                // group -> the time of the last start
        this.last_var = {};
        this.combat = 0.0;             // intensity of fighting near the player (for the music)
        this.music = null;
        this.icon_rect = null;
        this.popup = false;
        this.pop_rect = null;
        this.drag = null;
        this.font = null;
        this.seen = null;
        this.sfx_time = 0.0;
        this.loaded = false;
        this.stats = {};               // name -> how many times it sounded (for checks)
        this.t0 = time.perf_counter();
        this.man = load_manifest();
        try {
            if (!pygame.mixer.get_init()) pygame.mixer.init();
            const [freq, , ch] = pygame.mixer.get_init();
            if (S != null) S.set_rate(freq);
            this.channels = ch;
            pygame.mixer.set_num_channels(40);
            let tp = null;
            if (py.bool(py.get(this.man, 'music', null))) {
                const { TrackPlayer } = modules.playlist;
                tp = new TrackPlayer(pygame, AUDIO_DIR, this.man);
            }
            if (tp != null && tp.ok) {
                this.music = tp;
                pygame.mixer.set_reserved(0);
            } else if (music != null) {                 // no files - procedural music
                pygame.mixer.set_reserved(4);
                const chs = [0, 1, 2, 3].map(i => pygame.mixer.Channel(i));
                this.music = new music.MusicPlayer(pygame, [[chs[0], chs[1]], [chs[2], chs[3]]]);
                this.music.prefetch();
            }
            if (this.music != null) {
                this.music.enabled = this.settings['music'];
                this.music.volume = this.settings['music_vol'];
            }
            this.ok = true;
        } catch (e) {
            this.ok = false;
            return;
        }
        // (a background thread in Python: async steps here, the frame loop does not wait)
        this._load().catch(e => console.warn('sound: loading effects failed', e));
    }

    // ---- preparing effects (in the background: the main loop does not wait)
    async _load() {
        const t = time.perf_counter();
        const smv = py.get(this.man, 'sfx', null);
        const sm = py.is_dict(smv) ? smv : {};
        try {
            await assets.load_group('sfx');
        } catch (e) {
            // missing files fall back to procedural sounds below
        }
        const order = py.sorted(Object.keys(sm), n => [n === 'click' ? 0 : group_of(n) === 'voice' ? 1 : 2, n]);
        for (const name of order) {
            const snds = [];
            for (const p of sm[name]) {
                try {
                    snds.push(new pygame.mixer.Sound(py.os.path.join(AUDIO_DIR, p)));
                } catch (e) {
                    // not loaded / not decodable (e.g. Opus on old Safari)
                }
            }
            if (snds.length) {
                this.gain[name] = _dget(SAMPLE_GAIN, group_of(name), 0.8);
                this.sfx[name] = snds;
            }
        }
        // procedural replacement - only for what is missing among the files (or for everything if there are none)
        if (S != null) {
            let need;
            if (!Object.keys(this.sfx).length) {
                need = ['click', 'sel_vil', 'cmd_vil', ...Object.keys(SFX).filter(k => !['click', 'sel_vil', 'cmd_vil'].includes(k))];
            } else {
                need = [];
                for (const n of py.sorted(new Set([...Object.keys(sm), ...runtime_names()]))) {
                    let k = n;
                    while (k != null && !_in(this.sfx, k) && !_in(SFX, k)) k = fallback_of(k);
                    if (k != null && !_in(this.sfx, k) && !need.includes(k)) need.push(k);
                }
            }
            for (const name of need) {
                await _tick();                  // one effect per macrotask: frames keep running
                try {
                    const lst = [];
                    for (let v = 0; v < SFX[name][1]; v++) lst.push(new pygame.mixer.Sound(wav_bytes(render_sfx(name, v), 2)));
                    this.sfx[name] = lst;
                } catch (e) {
                    // no sound for this one
                }
            }
        }
        this.sfx_time = time.perf_counter() - t;
        this.loaded = true;
    }

    /** The first ready name from the list; if there is none - go through the replacement chains (FALLBACK). */
    resolve(names) {
        if (typeof names === 'string') names = [names];
        for (const n of names) {
            if (_in(this.sfx, n)) return n;
        }
        for (const n of names) {
            let k = fallback_of(n);
            for (let q = 0; q < 5; q++) {
                if (k == null) break;
                if (_in(this.sfx, k)) return k;
                k = fallback_of(k);
            }
        }
        return null;
    }

    // ---- settings
    _sync_settings() {
        const d = load_settings();
        if (d['music'] !== this.settings['music']) this.toggle_music_to(d['music']);
        if (d['sfx'] !== this.settings['sfx'] && !d['sfx'] && this.ok) {
            for (const lst of Object.values(this.playing)) for (const [c] of lst) c.stop();
        }
        this.settings['sfx'] = d['sfx'];
        for (const k of ['music', 'sfx', 'voice']) if (d[k + '_vol'] !== this.settings[k + '_vol']) this.set_volume(k, d[k + '_vol']);
    }

    toggle_music_to(on) {
        this.settings['music'] = on;
        if (this.music) this.music.enabled = on;
    }

    toggle_music() {
        this.settings['music'] = !this.settings['music'];
        if (this.music) this.music.enabled = this.settings['music'];
        save_settings(this.settings);
    }

    toggle_sfx() {
        this.settings['sfx'] = !this.settings['sfx'];
        if (!this.settings['sfx'] && this.ok) {
            for (const lst of Object.values(this.playing)) {
                for (const [c] of lst) c.stop();
            }
        }
        save_settings(this.settings);
    }

    set_volume(key, v) {
        v = Math.max(0.0, Math.min(1.0, v));
        this.settings[key + '_vol'] = py.round(v, 3);
        if (key === 'music' && this.music) this.music.volume = v;
    }

    // ---- volume window: [music] --*-- 50 %   [speaker] ----*- 80 %
    _pop_layout() {
        if (!py.bool(this.icon_rect)) return null;
        const x = Math.max(6, Math.min(this.icon_rect.x - 8, SCREEN_W - POP_W - 6));
        const y = this.icon_rect.bottom + 6;
        const r = new pygame.Rect(x, y, POP_W, POP_H);
        const rows = {};
        ['music', 'sfx'].forEach((key, i) => {
            const ry = y + 12 + i * 32;
            rows[key] = [new pygame.Rect(x + 8, ry, 28, 24), new pygame.Rect(x + 46, ry + 4, 116, 16)];
        });
        return [r, rows];
    }

    _slide(key, px) {
        const lay = this._pop_layout();
        if (lay) {
            const tr = lay[1][key][1];
            this.set_volume(key, (px - tr.x) / tr.w);
        }
    }

    /** Keys M (music), N (effects), the speaker icon (the volume window). true - the event was consumed. */
    handle(e) {
        if (e.type === pygame.KEYDOWN) {
            if ((e.key === pygame.K_m || e.key === pygame.K_n) &&
                    !(pygame.key.get_mods() & (pygame.KMOD_CTRL | pygame.KMOD_META))) {
                if (e.key === pygame.K_m) {
                    this.toggle_music();
                } else {
                    this.toggle_sfx();
                    this.click();
                }
                return true;
            }
            if (e.key === pygame.K_ESCAPE && this.popup) {
                this.popup = false;
                return true;
            }
            return false;
        }
        if (e.type === pygame.MOUSEMOTION && this.drag) {
            this._slide(this.drag, e.pos[0]);
            return true;
        }
        if (e.type === pygame.MOUSEBUTTONUP && this.drag) {
            if (this.drag === 'sfx') this.click();
            this.drag = null;
            save_settings(this.settings);
            return true;
        }
        if (e.type === pygame.MOUSEBUTTONDOWN) {
            if (e.button === 1 && py.bool(this.icon_rect) && this.icon_rect.collidepoint(e.pos)) {
                this.popup = !this.popup;
                this.click();
                return true;
            }
            if (this.popup) {
                const lay = this._pop_layout();
                if (lay && lay[0].collidepoint(e.pos)) {
                    if (e.button === 1) {
                        for (const [key, [ib, tr]] of Object.entries(lay[1])) {
                            if (ib.collidepoint(e.pos)) {
                                if (key === 'music') this.toggle_music(); else this.toggle_sfx();
                                this.click();
                            } else if (tr.inflate(10, 8).collidepoint(e.pos)) {
                                this.drag = key;
                                this._slide(key, e.pos[0]);
                            }
                        }
                    } else if (e.button === 4 || e.button === 5) {                       // wheel over the window
                        for (const [key, [ib, tr]] of Object.entries(lay[1])) {
                            if (ib.union(tr).inflate(0, 8).collidepoint(e.pos)) {
                                this.set_volume(key, this.settings[key + '_vol'] + (e.button === 4 ? 0.05 : -0.05));
                                save_settings(this.settings);
                            }
                        }
                    }
                    return true;
                }
                this.popup = false;                                 // a click elsewhere - close, the click is not lost
                return false;
            }
        }
        if (e.type === pygame.MOUSEWHEEL && this.popup && py.bool(this.pop_rect) &&
                this.pop_rect.collidepoint(pygame.mouse.get_pos())) {
            return true;
        }
        return false;
    }

    // ---- speaker icon
    /** A speaker with waves (sound) and a note (music); a disabled one is crossed out. A click - the volume window. */
    draw_icon(scr, x, y, size = 20) {
        const r = new pygame.Rect(x, y, size + 22, size);
        this.icon_rect = r;
        const sfx_on = this.settings['sfx'] && this.ok, mus_on = this.settings['music'] && this.ok;
        const cy = y + Math.floor(size / 2);
        if (this.popup) pygame.draw.rect(scr, [70, 58, 40], r.inflate(6, 6), 0, 4);
        draw_speaker(scr, x, cy, sfx_on, sfx_on ? ON_C : OFF_C);
        draw_note(scr, x + size + 8, cy, mus_on, mus_on ? ON_C : OFF_C);
        return r;
    }

    /** The volume window under the icon: two rows "toggle icon + slider + %". */
    draw_popup(scr) {
        if (!this.popup) {
            this.pop_rect = null;
            return;
        }
        const lay = this._pop_layout();
        if (!lay) return;
        const [r, rows] = lay;
        this.pop_rect = r;
        if (this.font == null) {
            // pygame.font.match_font('arial') finds no system fonts in the browser -> the default font
            this.font = new pygame.font.Font(pygame.font.match_font('arial') || null, 14);
        }
        pygame.draw.rect(scr, [34, 27, 19], r, 0, 6);
        pygame.draw.rect(scr, [150, 120, 70], r, 1, 6);
        const mp = pygame.mouse.get_pos();
        for (const [key, [ib, tr]] of Object.entries(rows)) {
            const on = this.settings[key] && this.ok;
            if (ib.collidepoint(mp)) pygame.draw.rect(scr, [70, 58, 40], ib, 0, 4);
            const cy = ib.centery;
            if (key === 'music') draw_note(scr, ib.x + 11, cy, on, on ? ON_C : OFF_C);
            else draw_speaker(scr, ib.x + 3, cy, on, on ? ON_C : OFF_C);
            const v = this.settings[key + '_vol'];
            const ty = tr.centery;
            pygame.draw.rect(scr, [70, 60, 48], [tr.x, ty - 3, tr.w, 6], 0, 3);
            const fill = on ? [220, 180, 90] : [130, 115, 90];
            pygame.draw.rect(scr, fill, [tr.x, ty - 3, Math.max(4, Math.trunc(tr.w * v)), 6], 0, 3);
            const kx = tr.x + Math.trunc(tr.w * v);
            pygame.draw.circle(scr, on ? [245, 230, 190] : [160, 145, 120], [kx, ty], 7);
            pygame.draw.circle(scr, [60, 45, 25], [kx, ty], 7, 1);
            const t = this.font.render(`${py.round(v * 100)}%`, true, on ? ON_C : OFF_C);
            scr.blit(t, t.get_rect({ midright: [r.right - 8, ty] }));
        }
    }

    // ---- playback
    play(names, left = 1.0, right = null, force = false, glob = false) {
        if (!this.ok || !this.settings['sfx']) return null;
        const name = this.resolve(names);
        if (name == null) return null;
        const snds = this.sfx[name];
        const g = group_of(name);
        const [gap, mx] = _dget(RULES, g, [0.05, 2]);
        const now = time.monotonic();
        if (now - _dget(this.last, g, -99) < gap) return null;
        let busy = _dget(this.playing, g, []).filter(([c, s]) => c.get_busy() && c.get_sound() === s);
        if (busy.length >= mx) {
            if (!REPLACE.has(g)) return null;
            busy[0][0].stop();
            busy = busy.slice(1);
        }
        let i = random.randrange(snds.length);
        if (snds.length > 1 && i === _dget(this.last_var, name, null)) i = (i + 1) % snds.length;
        this.last_var[name] = i;
        const s = snds[i];
        const ch = pygame.mixer.find_channel(force);
        if (ch == null) return null;
        if (glob) left = right = _dget(GLOBAL_GAIN, g, _dget(GLOBAL_GAIN, name, 0.7));
        // voices - their own slider
        const vol = g === 'voice' ? py.get(this.settings, 'voice_vol', 0.8) : this.settings['sfx_vol'];
        const k = vol * _dget(this.gain, name, 1.0) * random.uniform(0.88, 1.0);
        ch.play(s);
        ch.set_volume(Math.min(1.0, left * k), Math.min(1.0, (right == null ? left : right) * k));
        busy.push([ch, s]);
        this.playing[g] = busy;
        this.last[g] = now;
        this.stats[name] = _dget(this.stats, name, 0) + 1;
        return ch;
    }

    play_global(names) {
        return this.play(names, undefined, undefined, true, true);
    }

    click() {
        this.play('click', 0.8);
    }

    /** [left, right] by screen position or null if far beyond the edge. */
    spatial(game, x, y) {
        const [sx, sy] = game.w2s(x, y);
        const hx = SCREEN_W / 2, hy = (SCREEN_H - PANEL_H - TOP_H) / 2;
        const dx = (sx - hx) / hx, dy = (sy - TOP_H - hy) / hy;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        if (d > 1.6) return null;
        const vol = d <= 0.6 ? 1.0 : (d <= 1 ? 1 - 0.65 * (d - 0.6) / 0.4 : 0.35 * (1.6 - d) / 0.6);
        const pan = Math.max(-1.0, Math.min(1.0, dx)) * 0.75;
        const a = (pan + 1) * Math.PI / 4;
        return [vol * Math.min(1.0, Math.cos(a) * 1.414), vol * Math.min(1.0, Math.sin(a) * 1.414)];
    }

    play_at(game, name, x, y, gain = 1.0) {
        const lr = this.spatial(game, x, y);
        if (lr != null) this.play(name, lr[0] * gain, lr[1] * gain);
        return lr;
    }

    // ---- world events -> sounds
    process(game, events) {
        const w = game.world;
        const human = py.getattr(w, 'human', 0);
        const me = w.players[human];
        for (const ev of events) {
            const typ = ev[0];
            const x = ev[1], y = ev[2], owner = ev[3];
            const kind = ev.length > 4 ? ev[4] : null;
            if (typ === 'select' || typ === 'command') {
                this.voice(game, typ, kind);
                continue;
            }
            if (typ === 'game_over') {
                const win = owner != null && owner === me.team;
                if (this.music && py.hasattr(this.music, 'stinger') && this.settings['music']) {
                    this.music.stinger(win);            // the victory/defeat piece instead of a short signal
                } else {
                    if (this.music) this.music.silence();
                    this.play_global(win ? 'victory' : 'defeat');
                }
                continue;
            }
            const mine = owner === human;
            const friendly = mine || (Number.isInteger(owner) && 0 <= owner && owner < w.players.length && py.bool(w.allied(human, owner)));
            if (POSITIONAL.includes(typ) && !friendly && py.hasattr(w, 'visible_px') && !w.visible_px(x, y)) {
                continue;                                   // not audible in the fog of war
            }
            if (typ === 'hit') {
                const name = this.hit_name(kind, ev.length > 5 ? ev[5] : null);
                const lr = this.play_at(game, name, x, y);
                if (friendly) this.combat += 0.12;
                else if (lr != null) this.combat += 0.05;
            } else if (typ === 'death') {
                this.play_at(game, this.death_name(kind), x, y);
            } else if (typ === 'destroy') {
                this.play_at(game, 'destroy', x, y);
                if (friendly) this.combat += 0.3;
            } else if (typ === 'arrow') {
                this.play_at(game, this.arrow_name(kind), x, y, 0.8);
            } else if (typ === 'work') {
                this.play_at(game, 'work_' + py.str(kind), x, y, 0.8);
            } else if (typ === 'place') {
                if (mine) this.play_at(game, 'place', x, y);
            } else if (typ === 'build_done') {
                if (mine) this.play_global('done_' + bkey(py.str(kind)));
            } else if (typ === 'train_done') {
                if (mine) {
                    const cls = _in(UNITS, kind) ? UNITS[kind]['cls'] : 'inf';
                    this.play_global(_dget(TRAIN, cls, 'train_inf'));
                }
            } else if (typ === 'tech_done') {
                if (mine) this.play_global('tech_done');
            } else if (typ === 'age_up') {
                this.play_global(mine ? 'age_up' : 'age_other');
            } else if (typ === 'attack_alert') {
                if (mine) {
                    this.play_global(_in(BUILDINGS, kind) ? 'alert_city' : 'alert');
                    this.combat += 0.4;
                }
            } else if (typ === 'flare') {
                if (friendly) {                               // an ally's (or own) signal - audible everywhere
                    this.play_global(['flare', 'alert']);
                }
            } else if (typ === 'defeat') {
                if (!mine) this.play_global(friendly ? 'defeat_ally' : 'defeat_other');
            } else if (typ === 'bell') {
                // own (and allied) town bell is audible everywhere - it is an alarm; another's - only nearby
                if (friendly) {
                    this.play_global('bell');
                    this.combat += 0.3;
                } else {
                    this.play_at(game, 'bell', x, y, 0.7);
                }
            } else if (typ === 'market' || typ === 'reseed') {
                if (mine) {                                   // a response to own action (the AI trades silently)
                    if (typ === 'market') this.play_global('market');
                    else this.play_at(game, 'reseed', x, y);
                }
            } else if (typ === 'tribute') {
                if (mine || kind === human) {                  // sent by us or sent to us
                    this.play_global('tribute');
                }
            } else if (typ === 'convert') {
                const old = ev.length > 5 ? ev[5] : null;
                const lr = this.play_at(game, 'convert', x, y);
                if (lr == null && (human === owner || human === old)) {   // ours was converted (or we converted) beyond the screen edge
                    this.play_global('convert');
                }
                if (old === human) this.combat += 0.2;
            } else if (['garrison', 'eject', 'upgrade', 'trade', 'convert_start', 'pack', 'blast', 'explode',
                'board', 'unload'].includes(typ)) {
                this.play_at(game, typ, x, y, ['trade', 'garrison', 'board'].includes(typ) ? 0.8 : 1.0);
                if ((typ === 'blast' || typ === 'explode') && friendly) this.combat += 0.1;
            }
        }
    }

    static hit_name(attacker, target) {
        if (_in(BUILDINGS, attacker)) {
            return 'hit_arrow';              // arrows of towers, centers, castles
        }
        const d = _dget(UNITS, attacker, null);
        if (d == null) {
            return 'hit_thud';               // animals
        }
        const cls = d['cls'], ac = py.get(d, 'ac', []), shot = py.get(d, 'shot', null);
        if (cls === 'siege') {
            if (py.contains(ac, 'ram')) return 'hit_ram';
            return shot === 'bolt' ? 'hit_arrow' : 'hit_siege';
        }
        if (cls === 'ship') {
            if (py.bool(py.get(d, 'siege', null))) return 'hit_siege';
            if (py.bool(py.get(d, 'fire', null)) || py.bool(py.get(d, 'blast', null))) {
                return _in(BUILDINGS, target) ? 'hit_bld' : 'hit_thud';
            }
            return 'hit_arrow';
        }
        if (py.bool(shot)) return shot === 'ball' ? 'hit_shot' : 'hit_arrow';
        if (cls === 'arch') return 'hit_arrow';
        if (_in(BUILDINGS, target)) return 'hit_bld';
        if (cls === 'inf') return py.contains(ac, 'spear') ? 'hit_pierce' : 'hit_melee';
        if (cls === 'cav') return 'hit_melee';
        return 'hit_thud';
    }

    static arrow_name(kind) {
        const d = _dget(UNITS, kind, null);
        if (d == null) {
            return 'arrow';                  // buildings
        }
        const shot = py.get(d, 'shot', null);
        if (d['cls'] === 'siege' || py.bool(py.get(d, 'siege', null))) {
            if (shot === 'bolt') return 'fire_bolt';
            return shot === 'ball' || py.bool(py.get(d, 'siege', null)) ? 'fire_cannon' : 'fire_siege';
        }
        if (shot === 'ball') return 'arrow_gun';
        if (shot === 'javelin') return 'arrow_jav';
        return 'arrow';
    }

    static death_name(kind) {
        const d = _dget(UNITS, kind, null);
        if (d == null) return _dget({ 'sheep': 'baa', 'boar': 'death_boar' }, kind, 'death_animal');
        const cls = d['cls'], ac = py.get(d, 'ac', []);
        if (cls === 'ship') return 'death_ship';
        if (cls === 'cav') {
            return py.contains(ac, 'elephant') ? 'death_elephant' : py.contains(ac, 'camel') ? 'death_camel' : 'death_horse';
        }
        if (kind === 'villager' && random.random() < 0.4) return 'death_female';
        return 'death';
    }

    /** A response to a selection/order: a short phrase in Latin (0 A.D.), for horses/elephants/machines - their own sound. */
    voice(game, typ, kind) {
        const sel = Array.from(py.getattr(game, 'selected', [])).filter(e => py.getattr(e, 'alive', true));
        const human = py.getattr(game.world, 'human', 0);
        const own = sel.length > 0 && py.getattr(sel[0], 'owner', -1) === human;
        if (typ === 'command') {
            const units = sel.filter(e => _in(UNITS, py.getattr(e, 'kind', null)));
            if (!units.length) return;
            const u = units[0];
            const d = UNITS[u.kind];
            const cls = d['cls'], ac = py.get(d, 'ac', []);
            const sx = is_female(u) ? '_f' : '_m';
            let names;
            if (cls === 'cav') {
                names = py.contains(ac, 'elephant') ? ['cmd_elephant'] : [kind === 'attack' ? 'cmd_cav_attack' : 'cmd_cav'];
            } else if (cls === 'siege') {
                names = [kind === 'attack' ? 'cmd_siege_attack' : 'cmd_siege'];
            } else if (cls === 'ship') {
                names = ['cmd_ship'];
            } else {
                const verb = _dget({ 'attack': 'attack', 'gather': 'gather', 'work': 'build', 'garrison': 'garrison',
                    'heal': 'heal' }, kind, 'move');
                names = [`cmd_${verb}${sx}`, `cmd_move${sx}`];
            }
            // procedural replacement - the former class "voices"
            names.push(kind === 'attack' && cls !== 'vil' ? 'cmd_attack' : 'cmd_' + _dget(CLS_KEY, cls, 'vil'));
            this.play(names, 0.8);
            return;
        }
        if (_in(UNITS, kind) && own) {
            const d = UNITS[kind];
            const cls = d['cls'], ac = py.get(d, 'ac', []);
            let names;
            if (cls === 'vil') names = [is_female(sel[0]) ? 'sel_vil_f' : 'sel_vil_m'];
            else if (cls === 'cav') names = [py.contains(ac, 'elephant') ? 'sel_elephant' : py.contains(ac, 'camel') ? 'sel_camel' : 'sel_cav'];
            else if (cls === 'siege') names = ['sel_siege'];
            else if (cls === 'ship') names = ['sel_ship'];
            else names = ['sel_mil'];
            this.play([...names, 'sel_' + _dget(CLS_KEY, cls, 'vil')], 0.8);
        } else if (_in(BUILDINGS, kind) && own) {
            this.play(['selb_' + bkey(kind, true), _dget(BUILDING_SEL, kind, 'sel_wood')], 0.7);
        } else if (kind === 'sheep') {
            this.play(['sel_sheep', 'baa'], 0.6);
        } else if (kind === 'boar') {
            this.play(['sel_boar', 'click'], 0.6);
        } else if (_in(RES_SEL, kind)) {
            this.play([RES_SEL[kind], 'click'], 0.6);
        } else {
            this.click();
        }
    }

    // ---- frame
    update(game, dt) {
        if (!this.ok) return;
        const state = game.state;
        if (state === 'play' && game.world != null) {
            const ev = game.events;
            if (ev !== this.seen) {
                this.seen = ev;
                if (py.bool(ev)) {
                    try {
                        this.process(game, ev);
                    } catch (e) {
                        // a sound must never crash the game
                    }
                }
            }
        }
        this.combat = Math.min(2.0, this.combat) * Math.exp(-dt / 5.0);
        if (this.music) {
            try {
                this.music.update(state === 'menu' ? 'menu' : 'play', dt, this.combat);
            } catch (e) {
                // ignore
            }
        }
    }
}
py.statics(Audio, 'hit_name', 'arrow_name', 'death_name');
