#!/usr/bin/env python3
"""A windowless sound check: renders all effects and music to WAV, prints the durations,
the peaks (clipping - if a peak > 0.9) and the generation time.

  .venv/bin/python tools/sounds.py                  # effects + music -> shots/sound/
  .venv/bin/python tools/sounds.py --no-music       # effects only
Exit code 1 - if a peak is above 0.9 anywhere."""
import argparse
import os
import sys
import time
import wave

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

import numpy as np  # noqa: E402

from game import synth as S  # noqa: E402
from game import sound, music  # noqa: E402


def save(path, x):
    x = np.asarray(x)
    if x.ndim == 1:
        x = x[:, None]
    with wave.open(path, 'wb') as wf:
        wf.setnchannels(x.shape[1])
        wf.setsampwidth(2)
        wf.setframerate(S.SR)
        wf.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='shots/sound')
    ap.add_argument('--no-music', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    bad = []
    t_all = time.perf_counter()
    print(f'{"effect":<16}{"var":>4}{"sec":>7}{"peak":>7}{"ms":>7}')
    for name, (_, nv, _) in sound.SFX.items():
        for v in range(nv):
            t = time.perf_counter()
            x = sound.render_sfx(name, v)
            ms = (time.perf_counter() - t) * 1000
            pk = float(np.abs(x).max())
            if pk > 0.9 or not np.isfinite(x).all():
                bad.append(f'{name}#{v}')
            save(os.path.join(a.out, f'{name}_{v}.wav'), x)
            print(f'{name:<16}{v:>4}{len(x) / S.SR:>7.2f}{pk:>7.2f}{ms:>7.0f}')
    print(f'all effects: {time.perf_counter() - t_all:.2f} s')
    if not a.no_music:
        print(f'\n{"piece":<10}{"loop, s":>9}{"peak":>7}{"peak+war":>9}{"render, s":>11}')
        for name, spec in music.ALL.items():
            t = time.perf_counter()
            base, war, secs = music.render(spec)
            dt = time.perf_counter() - t
            pk = float(np.abs(base).max())
            pkw = pk
            if war is not None:
                pkw = float(np.abs(base + np.tile(war, (len(base) // len(war), 1))).max())
                save(os.path.join(a.out, f'music_{name}_war.wav'), war)
                save(os.path.join(a.out, f'music_{name}_full.wav'),
                     base + np.tile(war, (len(base) // len(war), 1)))
            save(os.path.join(a.out, f'music_{name}.wav'), base)
            if pkw > 0.9:
                bad.append(f'music {name}')
            print(f'{name:<10}{secs:>9.1f}{pk:>7.2f}{pkw:>9.2f}{dt:>11.2f}')
    # the sound system start-up time (without cached music - it is in the background)
    import pygame
    sound.pre_init()
    pygame.init()
    t = time.perf_counter()
    au = sound.Audio()
    t_init = time.perf_counter() - t
    while au.ok and not au.loaded and time.perf_counter() - t < 10:
        time.sleep(0.05)
    print(f'\nAudio(): {t_init * 1000:.0f} ms in the main thread; effects ready in the background in {au.sfx_time:.2f} s '
          f'(mixer: {pygame.mixer.get_init()}, ok={au.ok})')
    pygame.quit()
    if bad:
        print('CLIPPING/error:', ', '.join(bad))
        sys.exit(1)
    print('ok: peaks <= 0.9')


if __name__ == '__main__':
    main()
