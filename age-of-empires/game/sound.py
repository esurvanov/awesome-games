"""Звук: записанные эффекты и музыка 0 A.D. (assets/audio, CC BY-SA 3.0), процедурные — как замена,
позиционирование по камере, туман войны, ограничение частоты.

Интерфейс (ui.Game):
  sound.pre_init()               — до pygame.init()
  self.audio = sound.Audio()     — после
  self.audio.handle(e)           — клавиши M / N, значок динамика и окно громкости (True — событие съедено)
  self.audio.update(self, dt)    — каждый кадр: события мира (game.events) → звуки, музыка по режиму
  self.audio.draw_popup(scr)     — поверх кадра: окно громкости (если открыто)
Файлы грузятся в фоновом потоке; без папки assets/audio звуки и музыка процедурные (нужен numpy).
Всё молча отключается, если нет аудиоустройства."""
import io
import json
import math
import os
import random
import threading
import time
import wave

import pygame

from .data import SCREEN_W, SCREEN_H, TOP_H, PANEL_H, UNITS, BUILDINGS

try:
    import numpy as np
    from . import synth as S
    from . import music
except ImportError:          # без numpy — только записанные звуки
    np = S = music = None

SETTINGS = os.path.join(os.environ.get('KHRONIKI_HOME') or os.path.join(os.path.expanduser('~'), '.cache', 'khroniki'),
                        'settings.json')


# ============================================================ эффекты (моно, float)
def _clang(v):
    r = S.rng(100 + v)
    f = (660, 780, 900, 720)[v % 4] * r.uniform(0.97, 1.03)
    n = S.n_of(0.42)
    t = S.tvec(n)
    metal = np.zeros(n)
    for ratio, a, tk in ((1, 1.0, 0.2), (1.51, 0.55, 0.13), (2.76, 0.4, 0.08), (3.93, 0.2, 0.05), (5.4, 0.1, 0.03)):
        metal += a * np.exp(-t / tk) * np.sin(S.TAU * f * ratio * t + r.uniform(0, S.TAU))
    click = S.spectral(r.standard_normal(n), S.band(1500, 6000)) * S.perc(n, 0.006, 0.0005)
    thud = np.sin(S.phase_of(S.glide(160, 90, n, 0.03), n)) * S.perc(n, 0.05)
    x = 0.45 * metal + 0.5 * click + 0.6 * thud
    if v % 2:                                      # второй, более слабый удар (клинок о щит)
        x = S.mix([(0, x, 1.0), (0.055, 0.5 * metal * S.perc(n, 0.08), 0.8)], n)
    return S.spectral(x, S.lp(6500, 2))


def _arrow_hit(v):
    r = S.rng(200 + v)
    n = S.n_of(0.2)
    body = np.sin(S.phase_of(S.glide(240, 115, n, 0.02), n)) * S.perc(n, 0.045)
    knock = S.spectral(r.standard_normal(n), S.bp(900 + 200 * v, 1.2)) * S.perc(n, 0.02, 0.0005)
    return 0.8 * body + 0.6 * knock


def _siege_hit(v):
    r = S.rng(300 + v)
    n = S.n_of(1.0)
    boom = np.sin(S.phase_of(S.glide(95, 36, n, 0.12), n)) * S.perc(n, 0.25)
    rumble = S.spectral(S.brown(n, r), S.lp(450)) * S.perc(n, 0.3, 0.005)
    crack = S.spectral(r.standard_normal(n), S.bp(1400, 1.5)) * S.perc(n, 0.025, 0.0005)
    return S.tail(boom + 0.9 * rumble + 0.5 * crack, 0.1)


def _thud(v):
    r = S.rng(400 + v)
    n = S.n_of(0.16)
    return (S.spectral(r.standard_normal(n), S.lp(700)) * S.perc(n, 0.035, 0.001)
            + 0.7 * np.sin(S.phase_of(S.glide(150, 90, n, 0.02), n)) * S.perc(n, 0.05))


def _wood(freqs, taus, n, r, noise_f=1800, noise_g=0.35):
    t = S.tvec(n)
    x = np.zeros(n)
    for f, tk in zip(freqs, taus):
        x += np.exp(-t / tk) * np.sin(S.TAU * f * t + r.uniform(0, S.TAU))
    x += noise_g * S.spectral(r.standard_normal(n), S.bp(noise_f, 1.3)) * S.perc(n, 0.006, 0.0003)
    na = S.n_of(0.001)
    x[:na] *= np.linspace(0, 1, na)
    return x


def _hit_bld(v):
    r = S.rng(500 + v)
    k = (1.0, 0.9, 1.1)[v % 3]
    return S.tail(_wood([170 * k, 390 * k, 660 * k], [0.08, 0.05, 0.03], S.n_of(0.3), r, 900), 0.03)


def _arrow(v):
    r = S.rng(600 + v)
    n = S.n_of(0.32)
    t = S.tvec(n)
    env = np.sin(np.pi * np.clip(t / 0.3, 0, 1)) ** 2 * np.exp(-t / 0.2)
    whoosh = S.spectral(r.standard_normal(n), S.bp(1300 + 250 * v, 1.4)) * env
    tw = S.pluck(140 + 15 * v, 0.3, 0.2, v) * np.exp(-S.tvec(S.n_of(0.3)) / 0.06)     # тетива
    return S.mix([(0, tw, 0.8), (0.015, whoosh, 0.5)], n)


def _grunt(v):
    n = S.n_of(0.38)
    f0 = (140, 115, 165, 125)[v % 4]
    f = S.glide(f0 * 1.15, f0 * 0.72, n, 0.18) * (1 + 0.02 * np.sin(S.TAU * 23 * S.tvec(n)))
    vow = ('uh', 'oh', 'eh', 'uh')[v % 4]
    x = S.voice(f, n, S.VOWELS[vow], 0.18, 700 + v)
    return S.tail(x * S.ramp(n, 0.015, 0.2) * S.perc(n, 0.22), 0.02)


def _neigh(v):
    n = S.n_of(0.9)
    t = S.tvec(n)
    base = S.glide(330, 520, n, 0.12) * np.where(t > 0.25, np.exp(-(t - 0.25) / 0.5), 1.0)
    f = np.maximum(base, 260) * (1 + 0.07 * np.sin(S.TAU * 11 * t) * np.clip(t / 0.2, 0, 1))
    x = S.voice(f, n, S.VOWELS['eh'], 0.35, 800 + v)
    return S.tail(x * S.ramp(n, 0.03, 0.3), 0.03)


def _baa(v):
    n = S.n_of(0.55)
    t = S.tvec(n)
    f = (310 + 30 * v) * (1 + 0.05 * np.sin(S.TAU * 7.5 * t)) * S.glide(1.08, 1.0, n, 0.08)
    x = S.voice(f, n, S.VOWELS['baa'], 0.12, 900 + v)
    return S.tail(x * S.ramp(n, 0.04, 0.2), 0.02)


def _animal(v):
    n = S.n_of(0.35)
    f = S.glide(230 + 40 * v, 120, n, 0.12)
    x = S.voice(f, n, S.VOWELS['oh'], 0.3, 950 + v)
    return S.tail(x * S.ramp(n, 0.01, 0.2), 0.02)


def _destroy(v):
    r = S.rng(1000 + v)
    n = S.n_of(1.8)
    t = S.tvec(n)
    rumble = S.spectral(S.brown(n, r), S.lp(600)) * S.perc(n, 0.55, 0.01)
    boom = np.sin(S.phase_of(S.glide(70, 32, n, 0.2), n)) * S.perc(n, 0.35)
    x = rumble + 0.8 * boom
    for _ in range(14):                  # треск ломающихся балок
        off = r.uniform(0, 0.9) ** 1.5
        m = S.n_of(0.12)
        c = _wood([r.uniform(250, 600), r.uniform(700, 1500)], [0.04, 0.02], m, r, r.uniform(900, 2500), 0.9)
        x = S.mix([(0, x, 1.0), (off, c, 0.25 * math.exp(-off * 1.5))], n)
    for _ in range(4):                   # падающие обломки
        off = r.uniform(0.5, 1.3)
        x = S.mix([(0, x, 1.0), (off, _thud(int(r.integers(9))), 0.25)], n)
    return S.tail(x * (1 - 0.3 * np.clip(t - 1.2, 0, 1)), 0.2)


def _chop(v):
    r = S.rng(1100 + v)
    k = (1.0, 0.93, 1.07)[v % 3]
    return S.tail(_wood([330 * k, 760 * k, 1210 * k], [0.05, 0.03, 0.02], S.n_of(0.18), r, 2200), 0.02)


def _mine(v):
    r = S.rng(1200 + v)
    n = S.n_of(0.26)
    t = S.tvec(n)
    f = (2100, 2350, 1950)[v % 3]
    ping = sum(a * np.exp(-t / tk) * np.sin(S.TAU * f * q * t)
               for q, a, tk in ((1, 1.0, 0.07), (2.43, 0.4, 0.035), (3.9, 0.2, 0.02)))
    crunch = S.spectral(r.standard_normal(n), S.bp(1100, 1.5)) * S.perc(n, 0.02, 0.0005)
    return S.tail(0.4 * ping + 0.8 * crunch, 0.02)


def _rustle(v, lo=2200, hi=7000, dur=0.34, grains=6):
    r = S.rng(1300 + v)
    n = S.n_of(dur)
    env = np.zeros(n)
    for _ in range(grains):
        c = r.uniform(0.02, dur - 0.06)
        env += np.exp(-((S.tvec(n) - c) / 0.025) ** 2) * r.uniform(0.4, 1.0)
    return S.tail(S.spectral(r.standard_normal(n), S.band(lo, hi)) * env, 0.02)


def _butcher(v):
    r = S.rng(1400 + v)
    n = S.n_of(0.18)
    return (S.spectral(r.standard_normal(n), S.lp(500)) * S.perc(n, 0.045, 0.002)
            + 0.3 * S.spectral(r.standard_normal(n), S.bp(900, 1)) * S.perc(n, 0.02))


def _hammer(v):
    r = S.rng(1500 + v)
    k = (1.0, 1.06, 0.95)[v % 3]
    n = S.n_of(0.16)
    t = S.tvec(n)
    tick = np.sin(S.TAU * 3200 * k * t) * S.perc(n, 0.012)
    return S.tail(_wood([520 * k, 1150 * k], [0.04, 0.025], n, r, 2800, 0.5) + 0.25 * tick, 0.02)


def _place(v):
    r = S.rng(1600 + v)
    a = _wood([200, 470], [0.06, 0.03], S.n_of(0.2), r, 1200)
    return S.mix([(0, a, 1.0), (0.1, a, 0.7)])


def _mono(st):
    return st.mean(axis=1) if st.ndim == 2 else st


def _build_done(v):
    notes = (74, 78, 81, 86)                           # ре мажорное трезвучие вверх
    parts = [(i * 0.09, S.bell(S.midi_hz(m), 1.4, i, soft=0.5), 0.8 - 0.1 * i) for i, m in enumerate(notes)]
    return S.reverb(S.mix(parts), 1.2, 0.25, 11)


def _train_done(v):
    parts = [(0, S.pluck(S.midi_hz(67), 0.9, 0.7, 1), 0.9), (0.11, S.pluck(S.midi_hz(74), 1.0, 0.7, 2), 1.0),
             (0.11, S.chime(S.midi_hz(86), 0.6), 0.25)]
    return S.reverb(S.mix(parts), 1.0, 0.18, 12)


def _tech_done(v):
    notes = (76, 81, 85, 88)
    parts = [(i * 0.075, S.chime(S.midi_hz(m), 1.1), 0.7) for i, m in enumerate(notes)]
    parts.append((0.3, S.bell(S.midi_hz(69), 1.6, 3, soft=0.7), 0.5))
    return S.reverb(S.mix(parts), 1.4, 0.3, 13)


def _fanfare(line, harm, tempo, seed, drums=True):
    """Фанфара: мелодия трубы + вторая труба (терция/квинта ниже) + литавры."""
    parts = []
    t = 0.0
    for (m, d), h in zip(line, harm):
        dur = d * tempo
        parts.append((t, S.brass(S.midi_hz(m), dur * 0.9, seed, bright=0.6), 0.55))
        if h:
            parts.append((t, S.brass(S.midi_hz(h), dur * 0.9, seed + 1, bright=0.6), 0.35))
        if drums and d >= 1:
            parts.append((t, S.drum(90, 55, 0.35, 0.25, seed), 0.5))
        t += dur
    return parts, t


def _age_up(v):
    line = [(62, 0.5), (62, 0.5), (69, 1), (66, 0.5), (69, 0.5), (74, 3)]
    harm = [57, 57, 62, 62, 66, 69]
    parts, end = _fanfare(line, harm, 0.3, 21)
    for i in range(10):                     # дробь литавр под последнюю ноту
        parts.append((end - 0.9 + i * 0.05, S.drum(110, 70, 0.1, 0.3, i), 0.15 + 0.03 * i))
    parts.append((end - 0.9, S.jingle(0.6, 5, 5), 0.12))
    parts.append((end - 0.9, S.bell(S.midi_hz(74), 2.0, 4, soft=0.4), 0.3))
    return S.reverb(S.mix(parts), 1.8, 0.3, 14)


def _age_other(v):
    parts, _ = _fanfare([(57, 1), (62, 2.5)], [50, 57], 0.3, 22, drums=False)
    return S.reverb(S.mix(parts), 1.6, 0.35, 15)


def _alert(v):
    """Боевой рог: низкая нота с подъездом, короткий + длинный сигнал."""
    f = S.midi_hz(43)
    a = S.brass(f, 0.4, 31, bright=1.0, scoop=0.08, vib=0.0)
    b = S.brass(f, 1.2, 32, bright=1.0, scoop=0.06, vib=0.003)
    nb = len(b)
    b = b * (1 - 0.02 * np.clip((S.tvec(nb) - 1.0) / 0.3, 0, 1))
    lo = S.brass(f / 2, 1.2, 33, bright=0.5, scoop=0.05, vib=0.0)
    x = S.mix([(0, a, 1.0), (0.55, b, 1.0), (0.55, lo, 0.35)])
    x = S.spectral(x, S.lp(1600, 2))
    return S.reverb(x, 2.0, 0.35, 16)


def _click(v):
    n = S.n_of(0.06)
    t = S.tvec(n)
    return np.sin(S.TAU * 1500 * t) * S.perc(n, 0.008) + 0.8 * np.sin(S.TAU * 380 * t) * S.perc(n, 0.015)


def _hm(f0, rise, dur, vowel='hm', seed=0):
    n = S.n_of(dur)
    f = S.glide(f0, f0 * rise, n, dur * 0.6) if rise != 1 else f0
    x = S.voice(f, n, S.VOWELS[vowel], 0.05, seed)
    return S.tail(x * S.ramp(n, 0.02, dur * 0.45), 0.01)


def _sel_vil(v):
    return _hm((150, 185, 220, 165)[v % 4], 1.12, 0.24, 'hm', 1700 + v)


def _shing(f=1850, dur=0.35, seed=0):
    n = S.n_of(dur)
    t = S.tvec(n)
    r = S.rng(seed)
    x = sum(a * np.exp(-t / tk) * np.sin(S.TAU * f * q * t + r.uniform(0, 6))
            for q, a, tk in ((1, 1, 0.12), (1.49, 0.5, 0.08), (2.61, 0.25, 0.05)))
    na = S.n_of(0.01)
    x[:na] *= np.linspace(0, 1, na)
    return x


def _sel_inf(v):
    return S.mix([(0, _hm((120, 105, 135)[v % 3], 0.95, 0.16, 'ha', 1800 + v), 1.0),
                  (0.02, _shing(1700 + 150 * v, 0.3, v), 0.25)])


def _sel_arch(v):
    tw = S.pluck(165 + 20 * v, 0.35, 0.25, v) * np.exp(-S.tvec(S.n_of(0.35)) / 0.1)
    return S.mix([(0, tw, 1.0), (0.05, S.recorder(S.midi_hz(76 + 2 * v), 0.1, v, vib=False), 0.35)])


def _snort(v):
    r = S.rng(1900 + v)
    n = S.n_of(0.3)
    t = S.tvec(n)
    env = np.exp(-((t - 0.05) / 0.03) ** 2) + 0.8 * np.exp(-((t - 0.16) / 0.045) ** 2)
    x = S.spectral(r.standard_normal(n), S.formant([(600, 1.2, 1.0), (1400, 1.0, 0.4)])) * env
    return S.tail(x, 0.02)


def _hoof(v, n_steps=3):
    r = S.rng(2000 + v)
    parts = [(i * 0.085, _wood([300, 820], [0.03, 0.015], S.n_of(0.08), r, 1500, 0.5), 1 - 0.15 * i)
             for i in range(n_steps)]
    return S.mix(parts)


def _sel_cav(v):
    return S.mix([(0, _snort(v), 1.0), (0.2, _hoof(v, 2), 0.4)])


def _creak(v, dur=0.35):
    r = S.rng(2100 + v)
    n = S.n_of(dur)
    t = S.tvec(n)
    f = 260 + 90 * np.sin(S.TAU * 2.2 * t + r.uniform(0, 6)) + 30 * S.spectral(r.standard_normal(n), S.lp(15))
    pulses = np.sin(S.phase_of(np.maximum(f, 60), n))
    x = np.sign(pulses) * np.abs(pulses) ** 0.3
    x = S.spectral(x, S.bp(900, 1.6)) * S.ramp(n, 0.03, 0.1)
    return S.tail(x, 0.02)


def _sel_siege(v):
    r = S.rng(2200 + v)
    return S.mix([(0, _creak(v), 0.8), (0.18, _wood([140, 330], [0.08, 0.04], S.n_of(0.25), r, 700), 0.7)])


def _sel_bell(v):
    return S.reverb(S.bell(S.midi_hz(72), 1.2, 7, soft=0.6), 1.0, 0.2, 17)


def _sel_anvil(v):
    return S.mix([(0, _shing(1500, 0.5, 40), 1.0), (0, _shing(2250, 0.3, 41), 0.3)])


def _sel_wood(v):
    r = S.rng(2300 + v)
    return _wood([260, 620], [0.05, 0.03], S.n_of(0.2), r, 1500)


def _sel_horn(v):
    parts, _ = _fanfare([(55, 1.2)], [None], 0.3, 24, drums=False)
    return S.mix(parts)


def _cmd_vil(v):
    a = (160, 190, 140)[v % 3]
    return S.mix([(0, _hm(a, 1.0, 0.1, 'hm', 2400 + v), 1.0), (0.11, _hm(a * 1.2, 1.05, 0.14, 'hm', 2410 + v), 0.9)])


def _cmd_inf(v):
    return _hm((125, 110, 140)[v % 3], 0.85, 0.14, 'ha', 2500 + v)


def _cmd_arch(v):
    m = (74, 76, 72)[v % 3]
    return S.mix([(0, S.recorder(S.midi_hz(m), 0.08, v, vib=False), 1.0),
                  (0.09, S.recorder(S.midi_hz(m + 5), 0.12, v, vib=False), 1.0)])


def _cmd_cav(v):
    return _hoof(v + 5, 3)


def _cmd_siege(v):
    return _creak(v + 3, 0.25)


def _cmd_attack(v):
    m = (50, 52, 48)[v % 3]
    return S.mix([(0, S.brass(S.midi_hz(m), 0.16, 26 + v, bright=1.0, scoop=0.06, vib=0), 0.8),
                  (0, S.brass(S.midi_hz(m + 7), 0.16, 27 + v, bright=1.0, scoop=0.06, vib=0), 0.5)])


def _victory(v):
    line = [(67, 0.5), (71, 0.5), (74, 1), (72, 0.5), (74, 0.5), (79, 1), (77, 0.5), (79, 0.5), (79, 4)]
    harm = [62, 67, 67, 67, 71, 74, 74, 74, 71]
    parts, end = _fanfare(line, harm, 0.28, 41)
    parts.append((end - 1.1, S.jingle(0.8, 6, 6), 0.12))
    for i, m in enumerate((67, 71, 74, 79)):
        parts.append((end - 1.1 + i * 0.08, S.bell(S.midi_hz(m + 12), 2.2, i, soft=0.5), 0.25))
    return S.reverb(S.mix(parts), 2.2, 0.35, 18)


def _defeat(v):
    line = [(57, 1), (55, 1), (53, 1), (52, 1.5), (50, 4)]
    harm = [50, 48, 46, 45, 45]
    parts, end = _fanfare(line, harm, 0.42, 42, drums=False)
    for i in range(3):
        parts.append((i * 0.84, S.drum(80, 45, 0.45, 0.2, i), 0.6))
    parts.append((end - 1.7, S.drum(70, 40, 0.6, 0.2, 9), 0.7))
    x = S.spectral(S.mix(parts), S.lp(2200, 2))
    return S.reverb(x, 2.5, 0.4, 19)


def _defeat_other(v):
    parts = [(0, S.drum(80, 45, 0.4, 0.2, 1), 0.7), (0.3, S.drum(80, 45, 0.4, 0.2, 2), 0.6)]
    p2, _ = _fanfare([(45, 3)], [38], 0.35, 43, drums=False)
    parts += [(0.3 + o, s, g * 0.8) for o, s, g in p2]
    return S.reverb(S.spectral(S.mix(parts), S.lp(1500, 2)), 1.8, 0.35, 20)


# ---- гарнизон, набат, улучшения зданий
def _door(v):
    """Тяжёлая дверь захлопнулась: глухой деревянный удар + щелчок засова."""
    r = S.rng(2600 + v)
    k = (1.0, 0.92, 1.08)[v % 3]
    n = S.n_of(0.32)
    thud = _wood([95 * k, 210 * k, 430 * k], [0.09, 0.05, 0.025], n, r, 700, 0.6)
    low = np.sin(S.phase_of(S.glide(120 * k, 70 * k, n, 0.04), n)) * S.perc(n, 0.07)
    latch = _wood([1900 * k, 3100 * k], [0.012, 0.008], S.n_of(0.05), r, 3500, 0.4)
    return S.tail(S.mix([(0, thud + 0.7 * low, 1.0), (0.13, latch, 0.35)], n), 0.02)


def _eject(v):
    """Выход из здания: скрип двери, затем топот нескольких ног."""
    r = S.rng(2700 + v)
    parts = [(0, _creak(v + 11, 0.3), 0.45), (0.22, _door(v), 0.6)]
    for i in range(4):
        m = S.n_of(0.07)
        step = S.spectral(r.standard_normal(m), S.lp(900)) * S.perc(m, 0.018, 0.001)
        parts.append((0.36 + i * 0.09 + r.uniform(0, 0.03), step, 0.5 - 0.06 * i))
    return S.tail(S.mix(parts), 0.02)


def _town_bell(v):
    """Набат: большой колокол и колокол поменьше звонят попеременно («бам-бом») три раза."""
    lo, hi = S.midi_hz(50), S.midi_hz(55)         # ре и соль малой октавы — тяжёлый медный звон
    parts = []
    for i in range(6):
        f = lo if i % 2 == 0 else hi
        g = 0.95 if i % 2 == 0 else 0.75
        parts.append((i * 0.42, S.bell(f, 2.6, 60 + i, soft=0.15), g * (1 - 0.05 * i)))
        # удар языка — короткий металлический щелчок в атаке
        m = S.n_of(0.03)
        clk = S.spectral(S.rng(70 + i).standard_normal(m), S.bp(2600, 1.2)) * S.perc(m, 0.005)
        parts.append((i * 0.42, clk, 0.25))
    x = S.spectral(S.mix(parts), S.lp(5000, 2))
    return S.reverb(x, 2.4, 0.35, 61)


def _upgrade(v):
    """Перестройка укрепления: удары по камню и светлый звон готовности."""
    r = S.rng(2800 + v)
    parts = []
    for i in range(3):
        m = S.n_of(0.2)
        stone = S.spectral(r.standard_normal(m), S.bp(1300 + 300 * i, 1.2)) * S.perc(m, 0.02, 0.0005)
        parts.append((i * 0.14, stone, 0.8))
        parts.append((i * 0.14, _shing(2400 + 180 * i, 0.18, 80 + i), 0.18))
    for i, m in enumerate((72, 76, 79)):
        parts.append((0.45 + i * 0.07, S.chime(S.midi_hz(m + 12), 0.8), 0.35))
    return S.reverb(S.mix(parts), 1.0, 0.2, 62)


# ---- рынок и торговля
def _coin(r, f=None):
    """Одна монета: короткий «дзинь» из негармонических парциалов."""
    f = f or r.uniform(3300, 4800)
    n = S.n_of(0.14)
    t = S.tvec(n)
    x = sum(a * np.exp(-t / tk) * np.sin(S.TAU * f * q * t + r.uniform(0, 6))
            for q, a, tk in ((1, 1.0, 0.05), (1.58, 0.6, 0.035), (2.31, 0.35, 0.02), (0.53, 0.25, 0.03)))
    na = S.n_of(0.0008)
    x[:na] *= np.linspace(0, 1, na)
    return x


def _coins(v, n_coins=4, spread=0.22, seed=2900, purse=True):
    r = S.rng(seed + v)
    parts = []
    for i in range(n_coins):
        parts.append((r.uniform(0, spread) + i * 0.02, _coin(r), r.uniform(0.5, 1.0)))
    if purse:                                          # кошель лёг на прилавок
        m = S.n_of(0.12)
        bag = S.spectral(r.standard_normal(m), S.lp(600)) * S.perc(m, 0.03, 0.002)
        parts.append((0, bag, 0.8))
    return S.tail(S.mix(parts), 0.02)


def _market(v):
    return _coins(v, 4 + v, 0.18)


def _tribute(v):
    """Дань: пересыпаются монеты, в конце — светлый аккорд колокольчиков."""
    parts = [(0, _coins(v, 12, 0.6, 3000, purse=True), 1.0)]
    for i, m in enumerate((79, 83, 86)):
        parts.append((0.55 + i * 0.06, S.chime(S.midi_hz(m), 0.7), 0.3))
    return S.reverb(S.mix(parts), 0.9, 0.15, 63)


def _trade(v):
    """Повозка пришла домой: скрип колёс, стук и звон выручки."""
    r = S.rng(3100 + v)
    parts = [(0, _creak(v + 20, 0.45), 0.5),
             (0.3, _wood([120, 280], [0.07, 0.04], S.n_of(0.2), r, 700), 0.6),
             (0.42, _coins(v + 5, 5, 0.25, 3150, purse=False), 0.8)]
    return S.tail(S.mix(parts), 0.02)


def _reseed(v):
    """Пересев фермы: лопата в землю и шорох зерна."""
    r = S.rng(3200 + v)
    n = S.n_of(0.2)
    dig = S.spectral(r.standard_normal(n), S.lp(800)) * S.perc(n, 0.05, 0.004)
    return S.mix([(0, dig, 1.0), (0.12, _rustle(v + 30, 1500, 5000, 0.3, 8), 0.5)])


# ---- монахи: неземной аккорд (своё звучание — «хор» на гласной и мягкий орган)
def _choir(notes, dur, seed, vowel='oh', att=0.5, rel=0.6):
    parts = []
    for i, m in enumerate(notes):
        n = S.n_of(dur)
        t = S.tvec(n)
        f0 = S.midi_hz(m) * (1 + 0.004 * np.sin(S.TAU * (4.8 + 0.3 * i) * t + i))     # живое вибрато
        x = S.voice(f0, n, S.VOWELS[vowel], 0.04, seed + i)
        x = x / (np.abs(x).max() + 1e-9) + 0.5 * np.sin(S.phase_of(S.midi_hz(m) * 1.002, n))
        parts.append((0, x * S.ramp(n, att, rel), 1.0 / len(notes)))
    return S.mix(parts)


def _convert_start(v):
    """Монах начал обращение: тихое нарастающее облако голосов (ми минор с ноной)."""
    notes = ((64, 71, 78, 67), (62, 69, 76, 65))[v % 2]
    x = _choir(notes, 1.5, 3300 + 10 * v, 'oh', att=1.0, rel=0.4)
    return S.reverb(S.spectral(x, S.lp(3000, 2)), 2.0, 0.4, 64)


def _convert(v):
    """Обращение свершилось: аккорд раскрывается в светлый мажор, сверху — звон."""
    x = _choir((60, 67, 76, 79, 84), 2.0, 3400 + v, 'ha', att=0.08, rel=1.2)
    parts = [(0, S.spectral(x, S.lp(3800, 2)), 1.0)]
    for i, m in enumerate((88, 91, 96)):
        parts.append((0.05 + i * 0.09, S.chime(S.midi_hz(m), 1.2), 0.18))
    return S.reverb(S.mix(parts), 2.4, 0.45, 65)


# ---- осада, взрывы
def _ratchet(v):
    """Сборка/разборка требушета: трещотка храповика и скрип рамы."""
    r = S.rng(3500 + v)
    parts = []
    for i in range(9):
        clk = _wood([900 + 60 * (i % 3), 2100], [0.015, 0.008], S.n_of(0.05), r, 2600, 0.6)
        parts.append((i * 0.075, clk, 0.6 + 0.05 * (i % 2)))
    parts.append((0.1, _creak(v + 40, 0.6), 0.35))
    parts.append((0.72, _wood([140, 320], [0.08, 0.04], S.n_of(0.25), r, 800), 0.7))
    return S.tail(S.mix(parts), 0.02)


def _blast(v):
    """Разрыв снаряда: короткий удар, грохот и разлёт комьев земли."""
    r = S.rng(3600 + v)
    n = S.n_of(1.0)
    boom = np.sin(S.phase_of(S.glide(120, 40, n, 0.08), n)) * S.perc(n, 0.18)
    crack = S.spectral(r.standard_normal(n), S.band(250, 2200)) * S.perc(n, 0.035, 0.0005)
    rumble = S.spectral(S.brown(n, r), S.lp(500)) * S.perc(n, 0.28, 0.004)
    x = boom + 0.35 * crack + 1.0 * rumble
    for _ in range(5):                                  # падающие комья
        off = r.uniform(0.18, 0.6)
        x = S.mix([(0, x, 1.0), (off, _thud(int(r.integers(9))), 0.15)], n)
    return S.tail(x, 0.1)


def _explode(v):
    """Подрыв брандера: большой взрыв, всплеск и шипение воды."""
    r = S.rng(3700 + v)
    n = S.n_of(2.0)
    t = S.tvec(n)
    boom = np.sin(S.phase_of(S.glide(90, 28, n, 0.15), n)) * S.perc(n, 0.4)
    blast = S.spectral(r.standard_normal(n), S.band(150, 2200)) * S.perc(n, 0.09, 0.0005)
    rumble = S.spectral(S.brown(n, r), S.lp(400)) * S.perc(n, 0.6, 0.01)
    env = np.exp(-((t - 0.35) / 0.25) ** 2) + 0.6 * np.exp(-t / 0.9) * (t > 0.3)
    splash = S.spectral(r.standard_normal(n), S.band(700, 5000)) * env
    x = boom + 0.5 * blast + 1.0 * rumble + 0.2 * splash
    return S.tail(x * (1 - 0.4 * np.clip(t - 1.4, 0, 1)), 0.15)


# ---- корабли
def _plank(v):
    """Шаги по сходням: глухой удар по доскам и скрип."""
    r = S.rng(3800 + v)
    k = (1.0, 0.9, 1.1)[v % 3]
    parts = [(0, _wood([110 * k, 240 * k, 520 * k], [0.08, 0.05, 0.025], S.n_of(0.3), r, 800, 0.5), 1.0),
             (0.16, _wood([130 * k, 300 * k], [0.06, 0.03], S.n_of(0.2), r, 900, 0.4), 0.6),
             (0.05, _creak(v + 50, 0.3), 0.2)]
    return S.tail(S.mix(parts), 0.02)


def _splash(v, dur=0.45, lo=700, hi=6000):
    r = S.rng(3900 + v)
    n = S.n_of(dur)
    t = S.tvec(n)
    env = np.exp(-((t - 0.04) / 0.03) ** 2) + 0.5 * np.exp(-t / (dur * 0.35))
    x = S.spectral(r.standard_normal(n), S.band(lo, hi)) * env
    bloop = np.sin(S.phase_of(S.glide(260, 620, n, 0.05), n)) * S.perc(n, 0.05)
    return S.tail(x + 0.4 * bloop, 0.02)


def _unload(v):
    """Высадка: доски сходней, затем плеск у берега."""
    return S.mix([(0, _plank(v + 3), 1.0), (0.3, _splash(v, 0.4), 0.45)])


def _fish(v):
    """Рыбацкий корабль: сеть шлёпает по воде."""
    return _splash(v + 5, 0.35, 900, 7000)


# имя → (построитель, число вариантов, пиковый уровень)
SFX = {
    'hit_melee': (_clang, 4, 0.55), 'hit_arrow': (_arrow_hit, 3, 0.5), 'hit_siege': (_siege_hit, 2, 0.8),
    'hit_thud': (_thud, 3, 0.45), 'hit_bld': (_hit_bld, 3, 0.55),
    'arrow': (_arrow, 3, 0.4),
    'death': (_grunt, 4, 0.5), 'death_horse': (_neigh, 2, 0.45), 'baa': (_baa, 2, 0.45), 'death_animal': (_animal, 2, 0.45),
    'destroy': (_destroy, 2, 0.8),
    'work_chop': (_chop, 3, 0.4), 'work_mine': (_mine, 3, 0.35), 'work_farm': (lambda v: _rustle(v, 1200, 4500), 3, 0.22),
    'work_forage': (lambda v: _rustle(v + 7, 1500, 5000, 0.26, 4), 3, 0.22), 'work_butcher': (_butcher, 3, 0.3),
    'work_build': (_hammer, 3, 0.45), 'place': (_place, 1, 0.5),
    'build_done': (_build_done, 1, 0.5), 'train_done': (_train_done, 1, 0.5), 'tech_done': (_tech_done, 1, 0.5),
    'age_up': (_age_up, 1, 0.8), 'age_other': (_age_other, 1, 0.5), 'alert': (_alert, 1, 0.85),
    'click': (_click, 1, 0.35),
    'sel_vil': (_sel_vil, 4, 0.35), 'sel_inf': (_sel_inf, 3, 0.5), 'sel_arch': (_sel_arch, 3, 0.5),
    'sel_cav': (_sel_cav, 3, 0.5), 'sel_siege': (_sel_siege, 2, 0.5),
    'sel_bell': (_sel_bell, 1, 0.45), 'sel_anvil': (_sel_anvil, 1, 0.35), 'sel_wood': (_sel_wood, 2, 0.4),
    'sel_horn': (_sel_horn, 1, 0.45),
    'cmd_vil': (_cmd_vil, 3, 0.35), 'cmd_inf': (_cmd_inf, 3, 0.45), 'cmd_arch': (_cmd_arch, 3, 0.3),
    'cmd_cav': (_cmd_cav, 2, 0.45), 'cmd_siege': (_cmd_siege, 2, 0.35), 'cmd_attack': (_cmd_attack, 3, 0.45),
    'victory': (_victory, 1, 0.85), 'defeat': (_defeat, 1, 0.85), 'defeat_other': (_defeat_other, 1, 0.6),
    # события, появившиеся после звуковой системы (гарнизон, рынок, монахи, осада, флот)
    'garrison': (_door, 3, 0.5), 'eject': (_eject, 2, 0.5), 'bell': (_town_bell, 1, 0.8),
    'upgrade': (_upgrade, 1, 0.55), 'market': (_market, 3, 0.45), 'tribute': (_tribute, 1, 0.5),
    'trade': (_trade, 2, 0.5), 'reseed': (_reseed, 2, 0.35),
    'convert_start': (_convert_start, 2, 0.4), 'convert': (_convert, 1, 0.6),
    'pack': (_ratchet, 2, 0.45), 'blast': (_blast, 3, 0.75), 'explode': (_explode, 1, 0.85),
    'board': (_plank, 3, 0.45), 'unload': (_unload, 2, 0.5), 'work_fish': (_fish, 3, 0.25),
}


def render_sfx(name, v):
    """Готовый сигнал эффекта (моно или стерео float), нормированный к своему пиковому уровню."""
    fn, _, peak = SFX[name]
    x = S.normalize(fn(v), peak)
    env = np.abs(x) if x.ndim == 1 else np.abs(x).max(axis=1)
    loud = np.nonzero(env > 0.002)[0]
    end = min(len(x), int(loud[-1]) + S.n_of(0.02)) if len(loud) else len(x)
    x = x[:end].copy()
    nr = min(end, S.n_of(0.02))                 # хвост реверберации гасим без щелчка
    ramp = np.linspace(1, 0, nr)
    x[end - nr:] *= ramp if x.ndim == 1 else ramp[:, None]
    return x


def wav_bytes(x, channels=2):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(S.SR)
        wf.writeframes(S.to_pcm(x, channels))
    return buf.getvalue()


# ============================================================ записанные звуки (0 A.D.)
AUDIO_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'audio')


def load_manifest(base=None):
    """assets/audio/manifest.json → dict (или {} — тогда звуки процедурные)."""
    try:
        with open(os.path.join(base or AUDIO_DIR, 'manifest.json'), encoding='utf-8') as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


# точное имя звука → более общее (цепочка заканчивается процедурным эффектом из SFX):
# так при отсутствии файлов у любого события остаётся голос
FALLBACK = {
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
}
# вид здания → суффикс файлов done_* / selb_*
BKEY = {'lumber_camp': 'camp', 'mining_camp': 'camp', 'guard_tower': 'tower', 'keep': 'tower',
        'palisade_wall': 'wall', 'stone_wall': 'wall', 'palisade_gate': 'gate'}
TRAIN = {'vil': 'train_vil', 'inf': 'train_inf', 'arch': 'train_inf', 'siege': 'train_inf', 'cav': 'train_cav',
         'monk': 'train_monk', 'ship': 'train_ship'}
RES_SEL = {'tree': 'sel_tree', 'gold': 'sel_gold', 'stone': 'sel_stone', 'berries': 'sel_berries'}


def fallback_of(name):
    if name in FALLBACK:
        return FALLBACK[name]
    if name.startswith('done_'):
        return 'build_done'
    if name.startswith('train_') and name != 'train_done':
        return 'train_done'
    if name.startswith('selb_'):
        return BUILDING_SEL.get(name[5:], 'sel_wood')
    return None


def bkey(kind, sel=False):
    if sel and kind == 'archery_range':
        return 'barracks'            # у 0 A.D. нет отдельного звука выбора стрельбища
    return BKEY.get(kind, kind)


def runtime_names():
    """Все имена, которые может запросить Audio (для проверки покрытия и процедурной замены)."""
    names = set(FALLBACK) | set(TRAIN.values()) | set(RES_SEL.values())
    names |= {'done_' + bkey(k) for k in BUILDINGS} | {'selb_' + bkey(k, True) for k in BUILDINGS}
    names |= {'work_' + w for w in ('chop', 'mine', 'farm', 'forage', 'butcher', 'build', 'fish')}
    names |= {'hit_melee', 'hit_arrow', 'hit_siege', 'hit_thud', 'hit_bld', 'arrow', 'death', 'death_horse',
              'death_animal', 'baa', 'destroy', 'place', 'tech_done', 'age_up', 'age_other', 'alert', 'click',
              'victory', 'defeat', 'defeat_other', 'bell', 'garrison', 'eject', 'upgrade', 'market', 'tribute',
              'trade', 'reseed', 'convert_start', 'convert', 'pack', 'blast', 'explode', 'board', 'unload'}
    return names


# ============================================================ правила воспроизведения
# группа → (минимальный интервал между запусками, сек; максимум одновременно)
RULES = {
    'hit_melee': (0.07, 4), 'hit_arrow': (0.06, 3), 'hit_siege': (0.15, 2), 'hit_thud': (0.09, 2), 'hit_bld': (0.1, 2),
    'arrow': (0.08, 3), 'fire': (0.15, 2), 'death': (0.12, 3), 'destroy': (0.3, 2),
    'work_chop': (0.15, 2), 'work_mine': (0.15, 2), 'work_farm': (0.25, 2), 'work_forage': (0.25, 2),
    'work_butcher': (0.2, 2), 'work_build': (0.15, 2), 'place': (0.1, 1),
    'build_done': (0.4, 1), 'train_done': (0.25, 1), 'tech_done': (0.4, 1),
    'age_up': (1.0, 1), 'age_other': (2.0, 1), 'alert': (4.0, 1), 'click': (0.03, 2),
    'voice': (0.05, 1), 'jingle': (1.0, 1), 'defeat_other': (1.0, 1),
    'garrison': (0.15, 2), 'eject': (0.4, 1), 'bell': (3.0, 1), 'upgrade': (0.5, 1), 'market': (0.12, 2),
    'tribute': (0.5, 1), 'trade': (0.5, 2), 'reseed': (0.3, 1), 'convert_start': (0.6, 2), 'convert': (0.8, 1),
    'pack': (0.4, 2), 'blast': (0.12, 3), 'explode': (0.3, 2), 'board': (0.15, 2), 'unload': (0.5, 1),
    'work_fish': (0.3, 2),
}
GROUP = {'victory': 'jingle', 'defeat': 'jingle', 'alert_city': 'alert', 'defeat_ally': 'defeat_other',
         'hit_pierce': 'hit_melee', 'hit_shot': 'hit_arrow', 'hit_ram': 'hit_siege',
         'arrow_jav': 'arrow', 'arrow_gun': 'arrow', 'fire_bolt': 'fire', 'fire_siege': 'fire', 'fire_cannon': 'fire'}
# звуки, для которых новый запуск обрывает предыдущий («голос» выбранного отряда)
REPLACE = {'voice'}
BUILDING_SEL = {'town_center': 'sel_bell', 'barracks': 'sel_inf', 'archery_range': 'sel_arch', 'stable': 'sel_cav',
                'blacksmith': 'sel_anvil', 'siege_workshop': 'sel_siege', 'castle': 'sel_horn', 'tower': 'sel_horn'}
CLS_KEY = {'vil': 'vil', 'inf': 'inf', 'arch': 'arch', 'cav': 'cav', 'siege': 'siege'}
GLOBAL_GAIN = {'alert': 0.9, 'age_up': 0.9, 'age_other': 0.55, 'victory': 1.0, 'defeat': 1.0, 'jingle': 1.0,
               'defeat_other': 0.7, 'build_done': 0.6, 'train_done': 0.55, 'tech_done': 0.6,
               'bell': 0.85, 'market': 0.6, 'tribute': 0.6, 'convert': 0.45}
# громкость записанных эффектов по группам (файлы выровнены к одной громкости при сборке —
# здесь баланс между собой: удары и работа тише оповещений)
SAMPLE_GAIN = {'hit_melee': 0.5, 'hit_arrow': 0.45, 'hit_siege': 0.75, 'hit_thud': 0.45, 'hit_bld': 0.45,
               'arrow': 0.35, 'fire': 0.6, 'death': 0.5, 'destroy': 0.85, 'blast': 0.7, 'explode': 0.85,
               'work_chop': 0.35, 'work_mine': 0.3, 'work_farm': 0.3, 'work_forage': 0.3, 'work_butcher': 0.3,
               'work_fish': 0.3, 'work_build': 0.35, 'place': 0.5, 'reseed': 0.4, 'voice': 0.7, 'click': 0.45,
               'garrison': 0.5, 'eject': 0.5, 'market': 0.55, 'trade': 0.5, 'pack': 0.5, 'board': 0.5,
               'unload': 0.5, 'convert_start': 0.45}
# события с местом на карте: чужие в тумане войны не слышны
POSITIONAL = ('hit', 'death', 'destroy', 'arrow', 'work', 'place', 'garrison', 'eject', 'bell', 'upgrade', 'trade',
              'reseed', 'convert_start', 'convert', 'pack', 'blast', 'explode', 'board', 'unload')


def group_of(name):
    if name.startswith(('sel_', 'cmd_', 'selb_')):
        return 'voice'
    if name.startswith('death') or name == 'baa':
        return 'death'
    if name.startswith('done_'):
        return 'build_done'
    if name.startswith('train_'):
        return 'train_done'
    return GROUP.get(name, name)


def is_female(u):
    """Пол жителя для голоса и крика: постоянный для юнита, ~40 % — женщины."""
    return getattr(u, 'kind', None) == 'villager' and (id(u) // 64) % 5 < 2


def pre_init():
    """До pygame.init(): 44.1 кГц, 16 бит, стерео, небольшой буфер (задержка ~23 мс)."""
    try:
        pygame.mixer.pre_init(44100, -16, 2, 1024)
    except Exception:
        pass


DEFAULTS = {'music': True, 'sfx': True, 'music_vol': 0.5, 'sfx_vol': 0.8, 'voice_vol': 0.8}


def load_settings():
    d = dict(DEFAULTS)
    try:
        with open(SETTINGS) as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            d.update(raw)
        for k in ('music', 'sfx'):
            d[k] = bool(d[k])
        for k in ('music_vol', 'sfx_vol', 'voice_vol'):
            d[k] = max(0.0, min(1.0, float(d[k])))
    except (OSError, ValueError, TypeError, AttributeError):
        d = dict(DEFAULTS)
    return d


def save_settings(d):
    try:
        cur = {}
        try:
            with open(SETTINGS) as f:          # сохраняем чужие ключи файла настроек
                cur = json.load(f)
            if not isinstance(cur, dict):
                cur = {}
        except (OSError, ValueError):
            pass
        cur.update({k: d[k] for k in DEFAULTS if k in d})
        os.makedirs(os.path.dirname(SETTINGS), exist_ok=True)
        with open(SETTINGS, 'w') as f:
            json.dump(cur, f)
    except OSError:
        pass


# ============================================================ окно громкости
POP_W, POP_H = 214, 80
ON_C, OFF_C, RED = (225, 210, 175), (120, 105, 85), (220, 90, 70)


def draw_speaker(scr, x, cy, on, c):
    pygame.draw.rect(scr, c, (x + 1, cy - 3, 4, 7))
    pygame.draw.polygon(scr, c, [(x + 5, cy - 3), (x + 10, cy - 8), (x + 10, cy + 8), (x + 5, cy + 3)])
    if on:
        for rad in (5, 9):
            pts = [(x + 8 + rad * math.cos(a), cy + rad * math.sin(a)) for a in (-0.8, -0.4, 0, 0.4, 0.8)]
            pygame.draw.lines(scr, c, False, pts, 2)
    else:
        pygame.draw.line(scr, RED, (x + 12, cy - 5), (x + 19, cy + 5), 2)
        pygame.draw.line(scr, RED, (x + 19, cy - 5), (x + 12, cy + 5), 2)


def draw_note(scr, nx, cy, on, c):
    pygame.draw.circle(scr, c, (nx, cy + 5), 3)
    pygame.draw.line(scr, c, (nx + 2, cy + 5), (nx + 2, cy - 7), 2)
    pygame.draw.line(scr, c, (nx + 2, cy - 7), (nx + 8, cy - 4), 2)
    if not on:
        pygame.draw.line(scr, RED, (nx - 5, cy + 8), (nx + 9, cy - 8), 2)


class Audio:
    def __init__(self):
        self.settings = load_settings()
        self.ok = False
        self.sfx = {}                 # имя → [Sound]
        self.gain = {}                # имя → множитель громкости (записанные звуки)
        self.playing = {}             # группа → [(канал, звук)]
        self.last = {}                # группа → время последнего запуска
        self.last_var = {}
        self.combat = 0.0             # накал боя рядом с игроком (для музыки)
        self.music = None
        self.icon_rect = None
        self.popup = False
        self.pop_rect = None
        self.drag = None
        self.font = None
        self.seen = None
        self.sfx_time = 0.0
        self.loaded = False
        self.stats = {}               # имя → сколько раз прозвучало (для проверок)
        self.t0 = time.perf_counter()
        self.man = load_manifest()
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            freq, _, ch = pygame.mixer.get_init()
            if S is not None:
                S.set_rate(freq)
            self.channels = ch
            pygame.mixer.set_num_channels(40)
            tp = None
            if self.man.get('music'):
                from .playlist import TrackPlayer
                tp = TrackPlayer(pygame, AUDIO_DIR, self.man)
            if tp is not None and tp.ok:
                self.music = tp
                pygame.mixer.set_reserved(0)
            elif music is not None:                 # нет файлов — процедурная музыка
                pygame.mixer.set_reserved(4)
                chs = [pygame.mixer.Channel(i) for i in range(4)]
                self.music = music.MusicPlayer(pygame, [(chs[0], chs[1]), (chs[2], chs[3])])
                self.music.prefetch()
            if self.music is not None:
                self.music.enabled = self.settings['music']
                self.music.volume = self.settings['music_vol']
            self.ok = True
        except Exception:
            self.ok = False
            return
        threading.Thread(target=self._load, daemon=True).start()

    # ---- подготовка эффектов (в фоне: основной поток не ждёт)
    def _load(self):
        t = time.perf_counter()
        sm = self.man.get('sfx', {}) if isinstance(self.man.get('sfx'), dict) else {}
        order = sorted(sm, key=lambda n: (0 if n == 'click' else 1 if group_of(n) == 'voice' else 2, n))
        for name in order:
            snds = []
            for p in sm[name]:
                try:
                    snds.append(pygame.mixer.Sound(os.path.join(AUDIO_DIR, p)))
                except Exception:
                    pass
            if snds:
                self.gain[name] = SAMPLE_GAIN.get(group_of(name), 0.8)
                self.sfx[name] = snds
        # процедурная замена — только для того, чего нет среди файлов (или для всего, если папки нет)
        if S is not None:
            if not self.sfx:
                need = ['click', 'sel_vil', 'cmd_vil'] + [k for k in SFX if k not in ('click', 'sel_vil', 'cmd_vil')]
            else:
                need = []
                for n in sorted(set(sm) | runtime_names()):
                    k = n
                    while k is not None and k not in self.sfx and k not in SFX:
                        k = fallback_of(k)
                    if k is not None and k not in self.sfx and k not in need:
                        need.append(k)
            for name in need:
                try:
                    self.sfx[name] = [pygame.mixer.Sound(file=io.BytesIO(wav_bytes(render_sfx(name, v), 2)))
                                      for v in range(SFX[name][1])]
                except Exception:
                    pass
        self.sfx_time = time.perf_counter() - t
        self.loaded = True

    def resolve(self, names):
        """Первое готовое имя из списка; если ни одного — идём по цепочкам замен (FALLBACK)."""
        if isinstance(names, str):
            names = (names,)
        for n in names:
            if n in self.sfx:
                return n
        for n in names:
            k = fallback_of(n)
            for _ in range(5):
                if k is None:
                    break
                if k in self.sfx:
                    return k
                k = fallback_of(k)
        return None

    # ---- настройки
    def toggle_music(self):
        self.settings['music'] = not self.settings['music']
        if self.music:
            self.music.enabled = self.settings['music']
        save_settings(self.settings)

    def toggle_sfx(self):
        self.settings['sfx'] = not self.settings['sfx']
        if not self.settings['sfx'] and self.ok:
            for lst in self.playing.values():
                for c, _ in lst:
                    c.stop()
        save_settings(self.settings)

    def set_volume(self, key, v):
        v = max(0.0, min(1.0, v))
        self.settings[key + '_vol'] = round(v, 3)
        if key == 'music' and self.music:
            self.music.volume = v

    # ---- окно громкости: [♪] ──●── 50 %   [🔈] ────●─ 80 %
    def _pop_layout(self):
        if not self.icon_rect:
            return None
        x = max(6, min(self.icon_rect.x - 8, SCREEN_W - POP_W - 6))
        y = self.icon_rect.bottom + 6
        r = pygame.Rect(x, y, POP_W, POP_H)
        rows = {}
        for i, key in enumerate(('music', 'sfx')):
            ry = y + 12 + i * 32
            rows[key] = (pygame.Rect(x + 8, ry, 28, 24), pygame.Rect(x + 46, ry + 4, 116, 16))
        return r, rows

    def _slide(self, key, px):
        lay = self._pop_layout()
        if lay:
            tr = lay[1][key][1]
            self.set_volume(key, (px - tr.x) / tr.w)

    def handle(self, e):
        """Клавиши M (музыка), N (эффекты), значок динамика (окно громкости). True — событие съедено."""
        if e.type == pygame.KEYDOWN:
            if e.key in (pygame.K_m, pygame.K_n) and not (pygame.key.get_mods() & (pygame.KMOD_CTRL | pygame.KMOD_META)):
                if e.key == pygame.K_m:
                    self.toggle_music()
                else:
                    self.toggle_sfx()
                    self.click()
                return True
            if e.key == pygame.K_ESCAPE and self.popup:
                self.popup = False
                return True
            return False
        if e.type == pygame.MOUSEMOTION and self.drag:
            self._slide(self.drag, e.pos[0])
            return True
        if e.type == pygame.MOUSEBUTTONUP and self.drag:
            if self.drag == 'sfx':
                self.click()
            self.drag = None
            save_settings(self.settings)
            return True
        if e.type == pygame.MOUSEBUTTONDOWN:
            if e.button == 1 and self.icon_rect and self.icon_rect.collidepoint(e.pos):
                self.popup = not self.popup
                self.click()
                return True
            if self.popup:
                lay = self._pop_layout()
                if lay and lay[0].collidepoint(e.pos):
                    if e.button == 1:
                        for key, (ib, tr) in lay[1].items():
                            if ib.collidepoint(e.pos):
                                self.toggle_music() if key == 'music' else self.toggle_sfx()
                                self.click()
                            elif tr.inflate(10, 8).collidepoint(e.pos):
                                self.drag = key
                                self._slide(key, e.pos[0])
                    elif e.button in (4, 5):                       # колесо над окном
                        for key, (ib, tr) in lay[1].items():
                            if ib.union(tr).inflate(0, 8).collidepoint(e.pos):
                                self.set_volume(key, self.settings[key + '_vol'] + (0.05 if e.button == 4 else -0.05))
                                save_settings(self.settings)
                    return True
                self.popup = False                                 # клик мимо — закрыть, клик не теряется
                return False
        if e.type == pygame.MOUSEWHEEL and self.popup and self.pop_rect and \
                self.pop_rect.collidepoint(pygame.mouse.get_pos()):
            return True
        return False

    # ---- значок динамика
    def draw_icon(self, scr, x, y, size=20):
        """Динамик с волнами (звук) и нотой (музыка); выключенное перечёркнуто. Клик — окно громкости."""
        r = pygame.Rect(x, y, size + 22, size)
        self.icon_rect = r
        sfx_on, mus_on = self.settings['sfx'] and self.ok, self.settings['music'] and self.ok
        cy = y + size // 2
        if self.popup:
            pygame.draw.rect(scr, (70, 58, 40), r.inflate(6, 6), border_radius=4)
        draw_speaker(scr, x, cy, sfx_on, ON_C if sfx_on else OFF_C)
        draw_note(scr, x + size + 8, cy, mus_on, ON_C if mus_on else OFF_C)
        return r

    def draw_popup(self, scr):
        """Окно громкости под значком: две строки «значок-переключатель + ползунок + %»."""
        if not self.popup:
            self.pop_rect = None
            return
        lay = self._pop_layout()
        if not lay:
            return
        r, rows = lay
        self.pop_rect = r
        if self.font is None:
            self.font = pygame.font.Font(pygame.font.match_font('arial') or None, 14)
        pygame.draw.rect(scr, (34, 27, 19), r, border_radius=6)
        pygame.draw.rect(scr, (150, 120, 70), r, 1, border_radius=6)
        mp = pygame.mouse.get_pos()
        for key, (ib, tr) in rows.items():
            on = self.settings[key] and self.ok
            if ib.collidepoint(mp):
                pygame.draw.rect(scr, (70, 58, 40), ib, border_radius=4)
            cy = ib.centery
            if key == 'music':
                draw_note(scr, ib.x + 11, cy, on, ON_C if on else OFF_C)
            else:
                draw_speaker(scr, ib.x + 3, cy, on, ON_C if on else OFF_C)
            v = self.settings[key + '_vol']
            ty = tr.centery
            pygame.draw.rect(scr, (70, 60, 48), (tr.x, ty - 3, tr.w, 6), border_radius=3)
            fill = (220, 180, 90) if on else (130, 115, 90)
            pygame.draw.rect(scr, fill, (tr.x, ty - 3, max(4, int(tr.w * v)), 6), border_radius=3)
            kx = tr.x + int(tr.w * v)
            pygame.draw.circle(scr, (245, 230, 190) if on else (160, 145, 120), (kx, ty), 7)
            pygame.draw.circle(scr, (60, 45, 25), (kx, ty), 7, 1)
            t = self.font.render(f'{int(round(v * 100))}%', True, ON_C if on else OFF_C)
            scr.blit(t, t.get_rect(midright=(r.right - 8, ty)))

    # ---- воспроизведение
    def play(self, names, left=1.0, right=None, force=False, glob=False):
        if not self.ok or not self.settings['sfx']:
            return None
        name = self.resolve(names)
        if name is None:
            return None
        snds = self.sfx[name]
        g = group_of(name)
        gap, mx = RULES.get(g, (0.05, 2))
        now = time.monotonic()
        if now - self.last.get(g, -99) < gap:
            return None
        busy = [(c, s) for c, s in self.playing.get(g, []) if c.get_busy() and c.get_sound() is s]
        if len(busy) >= mx:
            if g not in REPLACE:
                return None
            busy[0][0].stop()
            busy = busy[1:]
        i = random.randrange(len(snds))
        if len(snds) > 1 and i == self.last_var.get(name):
            i = (i + 1) % len(snds)
        self.last_var[name] = i
        s = snds[i]
        ch = pygame.mixer.find_channel(force)
        if ch is None:
            return None
        if glob:
            left = right = GLOBAL_GAIN.get(g, GLOBAL_GAIN.get(name, 0.7))
        vol = self.settings.get('voice_vol', 0.8) if g == 'voice' else self.settings['sfx_vol']   # голоса — свой ползунок
        k = vol * self.gain.get(name, 1.0) * random.uniform(0.88, 1.0)
        ch.play(s)
        ch.set_volume(min(1.0, left * k), min(1.0, (left if right is None else right) * k))
        busy.append((ch, s))
        self.playing[g] = busy
        self.last[g] = now
        self.stats[name] = self.stats.get(name, 0) + 1
        return ch

    def play_global(self, names):
        return self.play(names, force=True, glob=True)

    def click(self):
        self.play('click', 0.8)

    def spatial(self, game, x, y):
        """(левый, правый) по положению на экране или None, если далеко за краем."""
        sx, sy = game.w2s(x, y)
        hx, hy = SCREEN_W / 2, (SCREEN_H - PANEL_H - TOP_H) / 2
        dx, dy = (sx - hx) / hx, (sy - TOP_H - hy) / hy
        d = max(abs(dx), abs(dy))
        if d > 1.6:
            return None
        vol = 1.0 if d <= 0.6 else (1 - 0.65 * (d - 0.6) / 0.4 if d <= 1 else 0.35 * (1.6 - d) / 0.6)
        pan = max(-1.0, min(1.0, dx)) * 0.75
        a = (pan + 1) * math.pi / 4
        return vol * min(1.0, math.cos(a) * 1.414), vol * min(1.0, math.sin(a) * 1.414)

    def play_at(self, game, name, x, y, gain=1.0):
        lr = self.spatial(game, x, y)
        if lr is not None:
            self.play(name, lr[0] * gain, lr[1] * gain)
        return lr

    # ---- события мира → звуки
    def process(self, game, events):
        w = game.world
        human = getattr(w, 'human', 0)
        me = w.players[human]
        for ev in events:
            typ = ev[0]
            x, y, owner = ev[1], ev[2], ev[3]
            kind = ev[4] if len(ev) > 4 else None
            if typ in ('select', 'command'):
                self.voice(game, typ, kind)
                continue
            if typ == 'game_over':
                win = owner is not None and owner == me.team
                if self.music and hasattr(self.music, 'stinger') and self.settings['music']:
                    self.music.stinger(win)            # пьеса победы/поражения вместо короткого сигнала
                else:
                    if self.music:
                        self.music.silence()
                    self.play_global('victory' if win else 'defeat')
                continue
            mine = owner == human
            friendly = mine or (isinstance(owner, int) and 0 <= owner < len(w.players) and w.allied(human, owner))
            if typ in POSITIONAL and not friendly and hasattr(w, 'visible_px') and not w.visible_px(x, y):
                continue                                   # в тумане войны не слышно
            if typ == 'hit':
                name = self.hit_name(kind, ev[5] if len(ev) > 5 else None)
                lr = self.play_at(game, name, x, y)
                if friendly:
                    self.combat += 0.12
                elif lr is not None:
                    self.combat += 0.05
            elif typ == 'death':
                self.play_at(game, self.death_name(kind), x, y)
            elif typ == 'destroy':
                self.play_at(game, 'destroy', x, y)
                if friendly:
                    self.combat += 0.3
            elif typ == 'arrow':
                self.play_at(game, self.arrow_name(kind), x, y, 0.8)
            elif typ == 'work':
                self.play_at(game, 'work_' + str(kind), x, y, 0.8)
            elif typ == 'place':
                if mine:
                    self.play_at(game, 'place', x, y)
            elif typ == 'build_done':
                if mine:
                    self.play_global('done_' + bkey(str(kind)))
            elif typ == 'train_done':
                if mine:
                    cls = UNITS[kind]['cls'] if kind in UNITS else 'inf'
                    self.play_global(TRAIN.get(cls, 'train_inf'))
            elif typ == 'tech_done':
                if mine:
                    self.play_global('tech_done')
            elif typ == 'age_up':
                self.play_global('age_up' if mine else 'age_other')
            elif typ == 'attack_alert':
                if mine:
                    self.play_global('alert_city' if kind in BUILDINGS else 'alert')
                    self.combat += 0.4
            elif typ == 'flare':
                if friendly:                               # сигнал союзника (или свой) — слышен везде
                    self.play_global(['flare', 'alert'])
            elif typ == 'defeat':
                if not mine:
                    self.play_global('defeat_ally' if friendly else 'defeat_other')
            elif typ == 'bell':
                # свой (и союзный) набат слышен везде — это тревога; чужой — только рядом
                if friendly:
                    self.play_global('bell')
                    self.combat += 0.3
                else:
                    self.play_at(game, 'bell', x, y, 0.7)
            elif typ in ('market', 'reseed'):
                if mine:                                   # отклик на своё действие (ИИ торгует молча)
                    if typ == 'market':
                        self.play_global('market')
                    else:
                        self.play_at(game, 'reseed', x, y)
            elif typ == 'tribute':
                if mine or kind == human:                  # отправили мы или прислали нам
                    self.play_global('tribute')
            elif typ == 'convert':
                old = ev[5] if len(ev) > 5 else None
                lr = self.play_at(game, 'convert', x, y)
                if lr is None and human in (owner, old):   # нашего обратили (или мы) за краем экрана
                    self.play_global('convert')
                if old == human:
                    self.combat += 0.2
            elif typ in ('garrison', 'eject', 'upgrade', 'trade', 'convert_start', 'pack', 'blast', 'explode',
                         'board', 'unload'):
                self.play_at(game, typ, x, y, 0.8 if typ in ('trade', 'garrison', 'board') else 1.0)
                if typ in ('blast', 'explode') and friendly:
                    self.combat += 0.1

    @staticmethod
    def hit_name(attacker, target):
        if attacker in BUILDINGS:
            return 'hit_arrow'              # стрелы башен, центров, замков
        d = UNITS.get(attacker)
        if d is None:
            return 'hit_thud'               # звери
        cls, ac, shot = d['cls'], d.get('ac', ()), d.get('shot')
        if cls == 'siege':
            if 'ram' in ac:
                return 'hit_ram'
            return 'hit_arrow' if shot == 'bolt' else 'hit_siege'
        if cls == 'ship':
            if d.get('siege'):
                return 'hit_siege'
            if d.get('fire') or d.get('blast'):
                return 'hit_bld' if target in BUILDINGS else 'hit_thud'
            return 'hit_arrow'
        if shot:
            return 'hit_shot' if shot == 'ball' else 'hit_arrow'
        if cls == 'arch':
            return 'hit_arrow'
        if target in BUILDINGS:
            return 'hit_bld'
        if cls == 'inf':
            return 'hit_pierce' if 'spear' in ac else 'hit_melee'
        if cls == 'cav':
            return 'hit_melee'
        return 'hit_thud'

    @staticmethod
    def arrow_name(kind):
        d = UNITS.get(kind)
        if d is None:
            return 'arrow'                  # здания
        shot = d.get('shot')
        if d['cls'] == 'siege' or d.get('siege'):
            if shot == 'bolt':
                return 'fire_bolt'
            return 'fire_cannon' if shot == 'ball' or d.get('siege') else 'fire_siege'
        if shot == 'ball':
            return 'arrow_gun'
        if shot == 'javelin':
            return 'arrow_jav'
        return 'arrow'

    @staticmethod
    def death_name(kind):
        d = UNITS.get(kind)
        if d is None:
            return {'sheep': 'baa', 'boar': 'death_boar'}.get(kind, 'death_animal')
        cls, ac = d['cls'], d.get('ac', ())
        if cls == 'ship':
            return 'death_ship'
        if cls == 'cav':
            return 'death_elephant' if 'elephant' in ac else 'death_camel' if 'camel' in ac else 'death_horse'
        if kind == 'villager' and random.random() < 0.4:
            return 'death_female'
        return 'death'

    def voice(self, game, typ, kind):
        """Отклик на выбор/приказ: короткая фраза на латыни (0 A.D.), у коней/слонов/машин — свой звук."""
        sel = [e for e in getattr(game, 'selected', []) if getattr(e, 'alive', True)]
        human = getattr(game.world, 'human', 0)
        own = sel and getattr(sel[0], 'owner', -1) == human
        if typ == 'command':
            units = [e for e in sel if getattr(e, 'kind', None) in UNITS]
            if not units:
                return
            u = units[0]
            d = UNITS[u.kind]
            cls, ac = d['cls'], d.get('ac', ())
            sx = '_f' if is_female(u) else '_m'
            if cls == 'cav':
                names = ['cmd_elephant'] if 'elephant' in ac else ['cmd_cav_attack' if kind == 'attack' else 'cmd_cav']
            elif cls == 'siege':
                names = ['cmd_siege_attack' if kind == 'attack' else 'cmd_siege']
            elif cls == 'ship':
                names = ['cmd_ship']
            else:
                verb = {'attack': 'attack', 'gather': 'gather', 'work': 'build', 'garrison': 'garrison',
                        'heal': 'heal'}.get(kind, 'move')
                names = [f'cmd_{verb}{sx}', f'cmd_move{sx}']
            # процедурная замена — прежние «голоса» классов
            names.append('cmd_attack' if kind == 'attack' and cls != 'vil' else 'cmd_' + CLS_KEY.get(cls, 'vil'))
            self.play(names, 0.8)
            return
        if kind in UNITS and own:
            d = UNITS[kind]
            cls, ac = d['cls'], d.get('ac', ())
            if cls == 'vil':
                names = ['sel_vil_f' if is_female(sel[0]) else 'sel_vil_m']
            elif cls == 'cav':
                names = ['sel_elephant' if 'elephant' in ac else 'sel_camel' if 'camel' in ac else 'sel_cav']
            elif cls == 'siege':
                names = ['sel_siege']
            elif cls == 'ship':
                names = ['sel_ship']
            else:
                names = ['sel_mil']
            self.play(names + ['sel_' + CLS_KEY.get(cls, 'vil')], 0.8)
        elif kind in BUILDINGS and own:
            self.play(['selb_' + bkey(kind, True), BUILDING_SEL.get(kind, 'sel_wood')], 0.7)
        elif kind == 'sheep':
            self.play(['sel_sheep', 'baa'], 0.6)
        elif kind == 'boar':
            self.play(['sel_boar', 'click'], 0.6)
        elif kind in RES_SEL:
            self.play([RES_SEL[kind], 'click'], 0.6)
        else:
            self.click()

    # ---- кадр
    def update(self, game, dt):
        if not self.ok:
            return
        state = game.state
        if state == 'play' and game.world is not None:
            ev = game.events
            if ev is not self.seen:
                self.seen = ev
                if ev:
                    try:
                        self.process(game, ev)
                    except Exception:
                        pass            # звук никогда не должен ронять игру
        self.combat = min(2.0, self.combat) * math.exp(-dt / 5.0)
        if self.music:
            try:
                self.music.update('menu' if state == 'menu' else 'play', dt, self.combat)
            except Exception:
                pass
