"""Reference values for web/tests/G10-audio.test.mjs: deterministic parts of game/synth.py, music.py, sound.py.
Run: SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy .venv/bin/python web/tests/gen_G10_audio_ref.py"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
import numpy as np  # noqa: E402
from game import synth as S, music, sound  # noqa: E402
from game.data import UNITS, BUILDINGS  # noqa: E402


def L(a):
    return [float(v) for v in np.asarray(a).ravel()]


out = {}
S.set_rate(44100)
out['fast_len'] = {str(n): S.fast_len(n) for n in (1, 2, 7, 100, 1000, 4097, 12345, 44100, 99999, 1234567)}
out['n_of'] = [S.n_of(d) for d in (0.0, 0.001, 0.0015, 0.02, 0.25, 1.2345, 2.5)]
out['midi_hz'] = [S.midi_hz(m) for m in (0, 43, 69, 81.5, 127)]
out['ramp'] = L(S.ramp(300, 0.002, 0.003))
out['perc'] = L(S.perc(200, 0.004, 0.001))
out['tail'] = L(S.tail(np.ones(500), 0.005))
out['glide'] = L(S.glide(300, 100, 100, 0.001))
out['phase_scalar'] = L(S.phase_of(440.0, 64))
out['phase_arr'] = L(S.phase_of(np.linspace(100, 900, 64), 64))
out['harmonic'] = L(S.harmonic(np.linspace(200, 260, 256), 256, [1.0, 0.5, 0.0, 0.25], S.ramp(256, 0.001, 0.001), 0.4))
out['chime'] = L(S.chime(880.0, 0.05))
sig = np.sin(np.arange(3000) * 0.37) + 0.3 * np.cos(np.arange(3000) * 2.1)
out['sp_lp'] = L(S.spectral(sig, S.lp(2000, 2)))
out['sp_band_circ'] = L(S.spectral(sig, S.band(500, 6000), circular=True))
out['sp_formant'] = L(S.spectral(sig, S.formant(S.VOWELS['ha'])))
out['sp_bp'] = L(S.spectral(sig, S.bp(1500, 1.2)))
out['mix'] = L(S.mix([(0, sig[:100], 1.0), (0.001, sig[:50], 0.5), (0.0, np.ones(10), 2.0)]))
out['normalize'] = L(S.normalize(sig[:64], 0.5))
st = np.stack([sig[:40], -sig[:40] * 0.5], axis=1)
out['pcm_st'] = list(S.to_pcm(st * 1.7, 2))
out['pcm_mono2'] = list(S.to_pcm(sig[:30], 2))
out['pcm_st1'] = list(S.to_pcm(st, 1))
out['click_sfx'] = L(sound.render_sfx('click', 0))
out['click_wav'] = list(sound.wav_bytes(sound.render_sfx('click', 0), 2))
out['deg_midi'] = [music.deg_midi(62, mode, d) for mode in music.MODES for d in range(-9, 16)]
tr = music.Track(50)
tr.put(np.arange(1, 131, dtype=float), 37, 0.7, -0.3)
out['track'] = L(tr.buf)
# sound tables
out['group_of'] = {n: sound.group_of(n) for n in ('sel_vil', 'cmd_x', 'selb_castle', 'death_horse', 'baa', 'done_house',
                                                   'train_vil', 'victory', 'fire_bolt', 'hit_melee', 'foo')}
out['fallback_of'] = {n: sound.fallback_of(n) for n in ('hit_pierce', 'done_house', 'train_vil', 'train_done',
                                                         'selb_castle', 'selb_house', 'foo')}
out['runtime_names'] = sorted(sound.runtime_names())
out['hit_name'] = {f'{a}|{t}': sound.Audio.hit_name(a, t) for a in list(UNITS) + ['town_center', 'wolf']
                   for t in ('house', 'villager')}
out['arrow_name'] = {k: sound.Audio.arrow_name(k) for k in list(UNITS) + ['tower']}
out['death_name'] = {k: sound.Audio.death_name(k) for k in list(UNITS) + ['sheep', 'boar', 'deer'] if k != 'villager'}
json.dump(out, open(os.path.join(ROOT, 'web', 'tests', 'fixtures', 'G10-audio.json'), 'w'))
print('ok', len(out))
