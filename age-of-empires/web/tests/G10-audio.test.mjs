// G10 audio: synth / music / sound deterministic parts vs CPython+numpy (fixtures/G10-audio.json from
// gen_G10_audio_ref.py), plus a smoke render of every procedural effect and of a music loop.
//   node --import ./web/tests/stub_loader.mjs --test web/tests/G10-audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ROOT } from './node_env.mjs';
await setup();
await import('../src/_data_init.js');
const S = await import('../src/synth.js');
const music = await import('../src/music.js');
const sound = await import('../src/sound.js');
const np = await import('../runtime/np.js');
const storage = await import('../runtime/storage.js');

const REF = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'tests', 'fixtures', 'G10-audio.json'), 'utf8'));
S.set_rate(44100);

function close(got, want, tol, name) {
    got = Array.from(got);
    assert.equal(got.length, want.length, `${name}: length`);
    let worst = 0;
    for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]));
    assert.ok(worst <= tol, `${name}: max abs diff ${worst} > ${tol}`);
}

test('synth scalars', () => {
    for (const [n, v] of Object.entries(REF.fast_len)) assert.equal(S.fast_len(+n), v, `fast_len(${n})`);
    assert.deepEqual([0.0, 0.001, 0.0015, 0.02, 0.25, 1.2345, 2.5].map(S.n_of), REF.n_of);
    close([0, 43, 69, 81.5, 127].map(S.midi_hz), REF.midi_hz, 1e-9, 'midi_hz');
});

test('synth envelopes and sources', () => {
    close(S.ramp(300, 0.002, 0.003), REF.ramp, 1e-12, 'ramp');
    close(S.perc(200, 0.004, 0.001), REF.perc, 1e-12, 'perc');
    close(S.tail(new Float64Array(500).fill(1), 0.005), REF.tail, 1e-12, 'tail');
    close(S.glide(300, 100, 100, 0.001), REF.glide, 1e-9, 'glide');
    close(S.phase_of(440.0, 64), REF.phase_scalar, 1e-9, 'phase scalar');
    close(S.phase_of(S._linspace(100, 900, 64), 64), REF.phase_arr, 1e-9, 'phase arr');
    close(S.harmonic(S._linspace(200, 260, 256), 256, [1.0, 0.5, 0.0, 0.25], S.ramp(256, 0.001, 0.001), 0.4),
        REF.harmonic, 1e-9, 'harmonic');
    close(S.chime(880.0, 0.05), REF.chime, 1e-9, 'chime');
});

test('synth: mixed-radix FFT equals the plain DFT; overlap-add reverb equals the FFT convolution', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 8, 12, 45, 60, 64, 100, 360, 1000, 1024, 1350, 7, 14, 77]) {
        const re = S._map(n, i => Math.sin(i * 1.3) + 0.2 * i), im = S._map(n, i => Math.cos(i * 0.7));
        for (const inv of [false, true]) {
            const ar = re.slice(), ai = im.slice(), br = re.slice(), bi = im.slice();
            S._rt_fft(ar, ai, inv);
            np._dft(br, bi, inv);
            close(ar, br, 1e-9 * n, `fft re n=${n} inv=${inv}`);
            close(ai, bi, 1e-9 * n, `fft im n=${n} inv=${inv}`);
        }
    }
    // reverb: compare with Python's formula irfft(rfft(x, size) * rfft(ir, size), size)
    const x = S._map(20000, i => Math.sin(i * 0.05) * Math.exp(-i / 8000));
    for (const circular of [false, true]) {
        const got = S.reverb(x, 0.2, 0.3, 5, circular);
        const m = x.length, size = circular ? m : S.fast_len(m + S.n_of(0.2) + 256);
        const X = np.fft.rfft(new np.NDArray(x, [m]), size);
        for (const [c, sd] of [[0, 5], [1, 6]]) {
            const ir = S.reverb_ir(Math.min(0.2, size / S.SR * 0.9), sd);
            const I = np.fft.rfft(new np.NDArray(ir, [ir.length]), size);
            const P = new np.Complex(X.re.map((v, k) => v * I.re[k] - X.im[k] * I.im[k]), X.re.map((v, k) => v * I.im[k] + X.im[k] * I.re[k]));
            let y = np.fft.irfft(P, size).data;
            if (!circular) y = y.slice(0, m + S.n_of(0.2));
            assert.equal(got.shape[0], y.length);
            const want = S._map(y.length, i => (i < m ? x[i] : 0) + 0.3 * y[i]);
            const col = S._map(y.length, i => got.data[2 * i + c]);
            close(col, want, 1e-9, `reverb circular=${circular} ch${c}`);
        }
    }
});

test('synth filters, mix, pcm', () => {
    const sig = S._map(3000, i => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 2.1));
    close(S.spectral(sig, S.lp(2000, 2)), REF.sp_lp, 1e-8, 'lp');
    close(S.spectral(sig, S.band(500, 6000), undefined, true), REF.sp_band_circ, 1e-8, 'band circular');
    close(S.spectral(sig, S.formant(S.VOWELS['ha'])), REF.sp_formant, 1e-8, 'formant');
    close(S.spectral(sig, S.bp(1500, 1.2)), REF.sp_bp, 1e-8, 'bp');
    close(S.mix([[0, sig.slice(0, 100), 1.0], [0.001, sig.slice(0, 50), 0.5], [0.0, new Float64Array(10).fill(1), 2.0]]), REF.mix, 1e-12, 'mix');
    close(S.normalize(sig.slice(0, 64), 0.5), REF.normalize, 1e-12, 'normalize');
    const st = S._stereo(40);
    for (let i = 0; i < 40; i++) { st.data[2 * i] = sig[i] * 1.7; st.data[2 * i + 1] = -sig[i] * 0.5 * 1.7; }
    assert.deepEqual(Array.from(S.to_pcm(st, 2)), REF.pcm_st, 'pcm stereo');
    assert.deepEqual(Array.from(S.to_pcm(sig.slice(0, 30), 2)), REF.pcm_mono2, 'pcm mono->2');
    const st1 = S._stereo(40);
    for (let i = 0; i < 40; i++) { st1.data[2 * i] = sig[i]; st1.data[2 * i + 1] = -sig[i] * 0.5; }
    // mean of two channels may differ by 1 LSB from numpy's pairwise mean
    close(S.to_pcm(st1, 1), REF.pcm_st1, 1, 'pcm stereo->1 (bytes)');
});

test('sound: click effect and its WAV are identical to Python', () => {
    close(sound.render_sfx('click', 0), REF.click_sfx, 1e-9, 'click');
    const w = sound.wav_bytes(sound.render_sfx('click', 0), 2);
    assert.equal(w.length, REF.click_wav.length);
    let diff = 0;
    for (let i = 0; i < w.length; i++) if (w[i] !== REF.click_wav[i]) diff++;
    assert.ok(diff <= 4, `wav bytes differ at ${diff} positions`);
    const info = S._rt_wav_info(w);
    assert.equal(info.framerate, 44100);
    assert.equal(info.nchannels, 2);
});

test('music: deg_midi, Track', () => {
    const got = [];
    for (const mode of Object.keys(music.MODES)) for (let d = -9; d < 16; d++) got.push(music.deg_midi(62, mode, d));
    assert.deepEqual(got, REF.deg_midi);
    const tr = new music.Track(50);
    tr.put(S._map(130, i => i + 1), 37, 0.7, -0.3);
    close(tr.buf.data, REF.track, 1e-9, 'track');
});

test('music: compose_section is well-formed', () => {
    for (const mode of Object.keys(music.PROGS)) {
        for (const meter of [6, 8]) {
            const notes = music.compose_section(music.PROGS[mode]['A'], meter, 3, 1234, true);
            let total = 0;
            for (const [st, dur] of notes) { assert.equal(st, total); total += dur; }
            assert.equal(total, 4 * meter);
            assert.equal(((notes[notes.length - 1][2] - 3) % 7 + 7) % 7, 0, 'final phrase ends on the center degree');
        }
    }
});

test('sound tables', () => {
    for (const [n, v] of Object.entries(REF.group_of)) assert.equal(sound.group_of(n), v, n);
    for (const [n, v] of Object.entries(REF.fallback_of)) assert.equal(sound.fallback_of(n), v, n);
    assert.deepEqual([...sound.runtime_names()].sort(), REF.runtime_names);
    for (const [k, v] of Object.entries(REF.hit_name)) {
        const [a, t] = k.split('|');
        assert.equal(sound.Audio.hit_name(a, t), v, k);
    }
    for (const [k, v] of Object.entries(REF.arrow_name)) assert.equal(sound.Audio.arrow_name(k), v, k);
    for (const [k, v] of Object.entries(REF.death_name)) assert.equal(sound.Audio.death_name(k), v, k);
});

test('sound settings round trip (storage)', () => {
    storage.write_text(sound.SETTINGS, JSON.stringify({ music: 0, sfx_vol: '1.5', lang: 'ru' }));
    const d = sound.load_settings();
    assert.equal(d.music, false);
    assert.equal(d.sfx_vol, 1.0);
    assert.equal(d.lang, 'ru');
    d.music_vol = 0.25;
    sound.save_settings(d);
    const raw = JSON.parse(storage.read_text(sound.SETTINGS));
    assert.equal(raw.lang, 'ru');
    assert.equal(raw.music_vol, 0.25);
    storage.write_text(sound.SETTINGS, JSON.stringify({ voice_vol: null }));
    assert.deepEqual(sound.load_settings(), sound.DEFAULTS);
});

test('every procedural effect renders (finite, within peak)', () => {
    const t0 = performance.now();
    for (const [name, [, count, peak]] of Object.entries(sound.SFX)) {
        for (let v = 0; v < count; v++) {
            const x = sound.render_sfx(name, v);
            const d = S._is_stereo(x) ? x.data : x;
            assert.ok(d.length > 0, name);
            let mx = 0;
            for (const s of d) { assert.ok(Number.isFinite(s), `${name}/${v} finite`); mx = Math.max(mx, Math.abs(s)); }
            assert.ok(mx <= peak + 1e-9 && mx > peak * 0.5, `${name}/${v} peak ${mx}`);
            const w = sound.wav_bytes(x, 2);
            assert.equal(S._rt_wav_info(w).nframes, S._len(x));
        }
    }
    console.log(`  all SFX rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
});

test('music: render the menu loop (seamless, no clipping) and cache it', () => {
    const t0 = performance.now();
    const d = music.load_or_render('menu');
    const secs = (performance.now() - t0) / 1000;
    console.log(`  menu loop ${d.secs.toFixed(1)} s rendered in ${secs.toFixed(1)} s`);
    assert.equal(d.war, null);
    const info = S._rt_wav_info(d.base);
    assert.equal(info.nchannels, 2);
    assert.ok(Math.abs(info.nframes / info.framerate - d.secs) < 1e-6);
    const again = music.load_or_render('menu');       // from the storage cache now
    assert.equal(again.gen, 0.0);
    assert.equal(again.base.length, d.base.length);
});

test('music: war layer divides the piece', () => {
    const [base, war, secs] = music.render(music.ALL['fields']);
    assert.equal(base.shape[0] % war.shape[0], 0);
    assert.ok(S._absmax(base) <= 0.85 + 1e-9);
    assert.ok(secs > 20);
});
