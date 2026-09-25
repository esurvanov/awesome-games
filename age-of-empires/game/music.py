"""Процедурная средневековая музыка: оригинальные пьесы, сочинённые по простым правилам
(лады дорийский / миксолидийский / эолийский, бурдон, щипковая лютня, блокфлейта, лёгкая перкуссия).

Каждая пьеса — бесшовная петля (хвосты нот и реверберация заворачиваются в начало) плюс
короткий «военный» слой (барабаны + низкий гул), длина которого ровно делит длину пьесы: оба слоя
запускаются одновременно и идут синхронно, а громкость военного слоя следует за накалом боя.

Рендер — в фоновом потоке, готовые петли кэшируются WAV-файлами в ~/.cache/khroniki/music/."""
import io
import os
import threading
import time
import wave

import numpy as np

from . import synth as S

VERSION = 3
CACHE_DIR = os.path.join(os.path.expanduser('~'), '.cache', 'khroniki', 'music')

MODES = {
    'dorian': (0, 2, 3, 5, 7, 9, 10),
    'mixolydian': (0, 2, 4, 5, 7, 9, 10),
    'aeolian': (0, 2, 3, 5, 7, 8, 10),
}
# последовательности аккордов (ступени лада) на 4 такта для частей формы
PROGS = {
    'dorian': {'A': (0, 6, 0, 3), 'A2': (0, 3, 6, 0), 'B': (2, 3, 6, 4), 'C': (3, 0, 6, 4)},
    'mixolydian': {'A': (0, 6, 0, 4), 'A2': (0, 6, 3, 0), 'B': (3, 0, 3, 6), 'C': (5, 6, 3, 4)},
    'aeolian': {'A': (0, 5, 6, 0), 'A2': (0, 3, 4, 0), 'B': (5, 2, 6, 4), 'C': (5, 6, 0, 4)},
}
# ритмы такта в «шагах» (восьмых)
RHYTHMS = {
    6: [(3, 3), (2, 1, 3), (2, 1, 2, 1), (3, 2, 1), (1, 1, 1, 3), (2, 1, 1, 1, 1)],
    8: [(2, 2, 2, 2), (3, 1, 2, 2), (2, 1, 1, 2, 2), (4, 2, 2), (2, 2, 4), (1, 1, 2, 2, 2), (3, 1, 4)],
}
CADENCE = {6: [(3, 3), (2, 1, 3), (6,)], 8: [(2, 2, 4), (4, 4), (2, 6), (8,)]}
ARPS = {
    6: [((0, 1), (4, 1), (7, 1), (9, 1), (7, 1), (4, 1)), ((0, 2), (4, 1), (7, 2), (4, 1)),
        ((0, 3), (7, 1), (4, 2))],
    8: [((0, 1), (4, 1), (7, 1), (4, 1), (9, 1), (4, 1), (7, 1), (4, 1)),
        ((0, 2), (4, 1), (7, 1), (0, 2), (4, 1), (7, 1)), ((0, 3), (4, 1), (7, 2), (4, 2))],
}

# Пьесы. bpm — для 6/8 в долях «четверть с точкой», для 4/4 — в четвертях.
PIECES = [
    dict(name='village', title='Утро в деревне', tonic=62, mode='dorian', meter=6, bpm=66, seed=11,
         form=('A', 'A2', 'B', 'A2', 'C', 'A2'), lead=('pluck', 'recorder'), perc='soft'),
    dict(name='fields', title='Поля у мельницы', tonic=67, mode='mixolydian', meter=8, bpm=92, seed=23,
         form=('A', 'A2', 'B', 'A2'), lead=('recorder', 'pluck'), perc='none'),
    dict(name='forest', title='Старый лес', tonic=69, mode='aeolian', meter=8, bpm=74, seed=37,
         form=('A', 'A2', 'C', 'A2'), lead=('pluck', 'recorder'), perc='none'),
    dict(name='fair', title='Ярмарка', tonic=64, mode='dorian', meter=6, bpm=76, seed=51,
         form=('A', 'A2', 'B', 'A2', 'A', 'A2'), lead=('recorder', 'pluck'), perc='light'),
]
MENU = dict(name='menu', title='Хроники', tonic=62, mode='aeolian', meter=8, bpm=68, seed=5,
            form=('A', 'A2', 'B', 'A2'), lead=('recorder', 'recorder'), perc='none', war=False)
ALL = {p['name']: p for p in PIECES + [MENU]}


# ============================================================ сочинение
def deg_midi(tonic, mode, d):
    sc = MODES[mode]
    return tonic + 12 * (d // 7) + sc[d % 7]


def compose_section(prog, meter, center, seed, final):
    """Мелодия на 4 такта: [(шаг, длительность, ступень)]. Сильные доли тяготеют к звукам аккорда,
    движение в основном поступенное, конец фразы — на тонике (final) или на звуке аккорда."""
    r = np.random.default_rng(seed)
    notes = []
    cur = center + int(r.choice((-2, 0, 2)))
    for bar, root in enumerate(prog):
        chord = {root % 7, (root + 2) % 7, (root + 4) % 7}
        last = bar == len(prog) - 1
        opts = CADENCE[meter] if last else RHYTHMS[meter]
        pat = opts[int(r.integers(len(opts)))]
        pos = 0
        for i, dur in enumerate(pat):
            strong = pos == 0 or pos == meter // 2
            if last and i == len(pat) - 1:
                targets = [center - 7, center, center + 7] if final else \
                    [d for d in range(center - 4, center + 6) if d % 7 in chord]
                cur = min(targets, key=lambda d: abs(d - cur) + (0 if d % 7 == 0 else 0.1))
            else:
                moves = np.array([-4, -3, -2, -1, 0, 1, 2, 3, 4])
                w = np.array([0.3, 0.5, 1.2, 3.0, 0.6, 3.0, 1.2, 0.5, 0.3])
                cand = cur + moves
                w = w * np.exp(-np.abs(cand - center) / 3.5)
                if strong:
                    w = w * np.where(np.isin(cand % 7, list(chord)), 3.0, 0.5)
                w = np.where((cand < center - 6) | (cand > center + 7), 0, w)
                cur = int(r.choice(cand, p=w / w.sum()))
            notes.append((bar * meter + pos, dur, cur))
            pos += dur
    return notes


# ============================================================ рендер
class Track:
    """Стерео-буфер петли с циклическим сложением (хвосты заворачиваются в начало)."""

    def __init__(self, n):
        self.n = n
        self.buf = np.zeros((n, 2))

    def put(self, sig, start, gain=1.0, pan=0.0):
        a = (pan + 1) * np.pi / 4
        gl, gr = gain * np.cos(a) * 1.414, gain * np.sin(a) * 1.414
        i = int(start) % self.n
        while len(sig):
            m = min(len(sig), self.n - i)
            self.buf[i:i + m, 0] += gl * sig[:m]
            self.buf[i:i + m, 1] += gr * sig[:m]
            sig = sig[m:]
            i = 0


def loop_drone(freqs, n, gain, reps, seed):
    """Бурдон (как у колёсной лиры): пилообразный спектр, целое число периодов на отрезок n/reps —
    отрезок тиражируется, стык петли без щелчка; медленное «дыхание» громкости раз в отрезок."""
    full, n = n, n // reps
    secs = n / S.SR
    t = S.tvec(n)
    r = np.random.default_rng(seed)
    out = np.zeros(n)
    for f in freqs:
        for det in (0.0, 0.0025):
            fa = round(f * (1 + det) * secs) / secs
            ph = S.TAU * fa * t + r.uniform(0, S.TAU)
            for k in range(1, 12):
                fk = k * fa
                if fk < 2500:       # мягкий «фильтр» прямо в амплитудах гармоник
                    out += np.sin(k * ph) / k ** 1.15 / np.sqrt(1 + (fk / 700) ** 4)
    lfo = 0.8 + 0.2 * np.sin(S.TAU * t / secs)
    return np.tile(S.normalize(out * lfo, gain), full // n + 1)[:full]


def render(spec):
    """→ (base (n,2), war (m,2) или None, секунд в петле)."""
    meter, tonic, mode = spec['meter'], spec['tonic'], spec['mode']
    step = 60.0 / spec['bpm'] / (3 if meter == 6 else 2)
    sn = max(1, int(round(step * S.SR / 64))) * 64      # кратно 64: быстрые БПФ и ровная дробь
    spb = meter
    form = spec['form']
    bars = 4 * len(form)
    n = bars * spb * sn
    tr = Track(n)
    seed = spec['seed']
    rr = np.random.default_rng(seed)
    center = 3
    melodies = {}
    for sec in set(form):
        melodies[sec] = compose_section(PROGS[mode][sec], meter, center + (2 if sec in ('B', 'C') else 0),
                                        seed * 31 + sum(map(ord, sec)), final=sec in ('A2',))
    seen = {}
    for si, sec in enumerate(form):
        base_step = si * 4 * spb
        rep = seen.get(sec, 0)
        seen[sec] = rep + 1
        inst = spec['lead'][(si // 2) % 2]
        # мелодия
        for st, dur, d in melodies[sec]:
            m = deg_midi(tonic, mode, d)
            f = S.midi_hz(m)
            secs = dur * step
            pos = (base_step + st) * sn
            if inst == 'pluck':
                tr.put(S.pluck(f, min(2.4, secs + 1.2), 0.55, seed), pos, 0.42, -0.25)
            else:
                ln = secs * 0.93
                if rep and dur >= 3 and rr.random() < 0.4:      # украшение: форшлаг сверху
                    g = S.midi_hz(deg_midi(tonic, mode, d + 1))
                    gl = 0.07
                    tr.put(S.recorder(g, gl, seed, vib=False), pos, 0.24, 0.25)
                    tr.put(S.recorder(f, ln - gl, seed), pos + S.n_of(gl), 0.3, 0.25)
                else:
                    tr.put(S.recorder(f, ln, seed), pos, 0.3, 0.25)
            if rep and inst == 'recorder' and dur >= 2:         # на повторе лютня подыгрывает октавой ниже
                tr.put(S.pluck(S.midi_hz(m - 12), min(2.0, secs + 0.8), 0.4, seed + 1), pos, 0.16, -0.3)
        # аккомпанемент
        prog = PROGS[mode][sec]
        for bar, root in enumerate(prog):
            pat = ARPS[meter][int(rr.integers(len(ARPS[meter])))]
            p = 0
            for off, dur in pat:
                m = deg_midi(tonic, mode, root + off - 7)
                tr.put(S.pluck(S.midi_hz(m), 1.4, 0.3, seed + 2), (base_step + bar * spb + p) * sn,
                       0.2 if p else 0.26, -0.45 + 0.1 * (off % 3))
                p += dur
        # тихая перкуссия мирного слоя
        if spec['perc'] != 'none':
            for bar in range(4):
                b0 = (base_step + bar * spb) * sn
                tr.put(S.drum(110, 65, 0.22, 0.15, seed + bar), b0, 0.2, 0.0)
                tr.put(S.drum(140, 90, 0.12, 0.2, seed + bar + 9), b0 + (spb // 2) * sn, 0.1, 0.1)
                if spec['perc'] == 'light':
                    for k in range(1, spb, 2):
                        tr.put(S.jingle(0.2, seed + k, 2), b0 + k * sn, 0.05, 0.3)
    # бурдон: тоника + квинта в басу
    drone = loop_drone([S.midi_hz(tonic - 24), S.midi_hz(tonic - 17)], n, 0.15, bars // 2, seed)
    tr.buf[:, 0] += drone
    tr.buf[:, 1] += drone
    mono = tr.buf.mean(axis=1)
    wet = S.reverb(mono, 1.6, 0.28, seed, circular=True)
    base = tr.buf + (wet - np.stack([mono, mono], axis=1))
    war = None
    if spec.get('war', True):
        war = render_war(spec, sn, spb)
    # общий масштаб: база и база+война без клиппинга
    peak = np.abs(base).max()
    if war is not None:
        tiled = np.tile(war, (n // len(war), 1))
        peak = max(peak, np.abs(base + tiled).max())
    k = 0.85 / max(peak, 1e-9)
    return base * k, (war * k if war is not None else None), n / S.SR


def render_war(spec, sn, spb):
    """Военный слой: 2 такта барабанов с дробью в конце + низкий гудящий рог на тонике."""
    n = 2 * spb * sn
    tr = Track(n)
    seed = spec['seed'] + 100
    hits = {6: [(0, 1.0), (2, 0.5), (3, 0.8), (5, 0.5)], 8: [(0, 1.0), (2, 0.5), (3, 0.45), (4, 0.9), (6, 0.5)]}
    for bar in range(2):
        b0 = bar * spb * sn
        for st, acc in hits[spb]:
            big = st == 0
            d = S.drum(95, 48, 0.32, 0.3, seed + st) if big else S.drum(190, 120, 0.1, 0.45, seed + st + 7)
            tr.put(d, b0 + st * sn, 0.55 * acc if big else 0.32 * acc, 0.0 if big else 0.15)
        for k in range(spb):
            if k % 2:
                tr.put(S.jingle(0.18, seed + k, 2), b0 + k * sn, 0.05, -0.2)
    # дробь в конце второго такта
    for i in range(4):
        tr.put(S.drum(210, 140, 0.07, 0.5, seed + 40 + i), (2 * spb - 1) * sn + i * sn // 4, 0.16 + 0.05 * i, 0.1)
    horn = S.brass(S.midi_hz(spec['tonic'] - 24), n / S.SR - 0.2, seed, bright=0.4, scoop=0.02, vib=0.003)
    swell = np.sin(np.linspace(0, np.pi, len(horn))) ** 1.5
    tr.put(horn * swell, 0, 0.1, 0.0)
    fifth = S.brass(S.midi_hz(spec['tonic'] - 17), n / S.SR * 0.5, seed + 3, bright=0.3, scoop=0.02, vib=0.003)
    tr.put(fifth * np.sin(np.linspace(0, np.pi, len(fifth))), spb * sn, 0.06, 0.2)
    mono = tr.buf.mean(axis=1)
    wet = S.reverb(mono, 1.0, 0.18, seed, circular=True)
    return tr.buf + (wet - np.stack([mono, mono], axis=1))


# ============================================================ WAV
def wav_bytes(x):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(S.SR)
        wf.writeframes(S.to_pcm(x, 2))
    return buf.getvalue()


def cache_path(name, layer):
    return os.path.join(CACHE_DIR, f'{name}-{layer}-v{VERSION}-{S.SR}.wav')


def load_or_render(name):
    """→ {'base': wav-байты, 'war': wav-байты | None, 'secs': длина петли, 'gen': секунд на рендер}."""
    spec = ALL[name]
    paths = {ly: cache_path(name, ly) for ly in ('base', 'war')}
    need_war = spec.get('war', True)
    try:
        if os.path.exists(paths['base']) and (not need_war or os.path.exists(paths['war'])):
            with open(paths['base'], 'rb') as f:
                base = f.read()
            war = None
            if need_war:
                with open(paths['war'], 'rb') as f:
                    war = f.read()
            with wave.open(io.BytesIO(base)) as wf:
                secs = wf.getnframes() / wf.getframerate()
            return {'base': base, 'war': war, 'secs': secs, 'gen': 0.0}
    except (OSError, wave.Error, EOFError):
        pass
    t0 = time.perf_counter()
    b, w, secs = render(spec)
    out = {'base': wav_bytes(b), 'war': wav_bytes(w) if w is not None else None, 'secs': secs,
           'gen': time.perf_counter() - t0}
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        for ly in ('base', 'war'):
            if out[ly] is not None:
                tmp = paths[ly] + '.tmp'
                with open(tmp, 'wb') as f:
                    f.write(out[ly])
                os.replace(tmp, paths[ly])
    except OSError:
        pass
    return out


# ============================================================ проигрыватель
class MusicPlayer:
    """Две пары зарезервированных каналов (база + война) для перекрёстного затухания пьес.
    Пьесы готовятся в фоновом потоке; пока нужная не готова — играет предыдущая (или тишина)."""
    def __init__(self, pg, channels):
        self.pg = pg
        self.chs = channels                  # [(base, war), (base, war)]
        self.ready = {}                      # name → (Sound, Sound|None, secs)
        self.want = []                       # очередь на подготовку
        self.lock = threading.Lock()
        self.thread = None
        self.cur = None                      # имя играющей пьесы
        self.pair = 0
        self.started = 0.0
        self.mode = None
        self.order = [p['name'] for p in PIECES]
        self.idx = -1
        self.war = 0.0
        self.volume = 0.45
        self.enabled = True
        self.hold = False                    # тишина (после конца партии), до смены режима
        self.gen_times = {}
        self.lvl = [0.0, 0.0]
        self.tgt = [0.0, 0.0]

    # ---- фоновая подготовка
    def request(self, name):
        with self.lock:
            if name in self.ready or name in self.want:
                return
            self.want.append(name)
            if self.thread is None:
                self.thread = threading.Thread(target=self._work, daemon=True)
                self.thread.start()

    def _work(self):
        while True:
            with self.lock:
                if not self.want:
                    self.thread = None
                    return
                name = self.want[0]
            try:
                d = load_or_render(name)
                base = self.pg.mixer.Sound(file=io.BytesIO(d['base']))
                war = self.pg.mixer.Sound(file=io.BytesIO(d['war'])) if d['war'] else None
                self.gen_times[name] = d['gen']
                self.ready[name] = (base, war, d['secs'])
            except Exception:           # без музыки, но игра продолжается
                self.ready[name] = None
            with self.lock:
                self.want.pop(0)

    # ---- управление
    def prefetch(self):
        """Меню → затем все пьесы по очереди: пока игрок в меню (процессор свободен), петли
        успевают отрендериться в кэш, и в партии фоновый поток уже не конкурирует с игрой."""
        for name in ['menu'] + self.order:
            self.request(name)

    def next_piece(self):
        self.idx = (self.idx + 1) % len(self.order)
        return self.order[self.idx]

    def start(self, name):
        """Запустить пьесу на свободной паре каналов; прежняя пара плавно гаснет (громкость
        ведём сами каждый кадр — встроенные fade у SDL конфликтуют с set_volume)."""
        item = self.ready.get(name)
        if not item:
            return False
        base, war, secs = item
        self.tgt[self.pair] = 0.0
        self.pair ^= 1
        cb, cw = self.chs[self.pair]
        self.lvl[self.pair] = 0.0
        self.tgt[self.pair] = 1.0
        cb.play(base, loops=-1)
        cb.set_volume(0.0)
        if war is not None:
            cw.play(war, loops=-1)
        else:
            cw.stop()
        cw.set_volume(0.0)
        self.cur = name
        self.started = time.monotonic()
        self.secs = secs
        return True

    def stop(self, fade=1.5):
        self.tgt = [0.0, 0.0]
        self.fade = fade
        self.cur = None

    def silence(self):
        """Конец партии: музыка затихает до возвращения в меню."""
        self.stop(1.2)
        self.hold = True

    def update(self, mode, dt, intensity):
        if mode != self.mode:
            self.mode = mode
            self.hold = False
            self.pending = 'menu' if mode == 'menu' else self.next_piece()
            if self.cur is not None:
                self.stop(1.5)
        if not self.enabled or self.hold:
            if self.cur is not None:
                self.stop(0.8)
        else:
            if self.cur is None and self.pending is None:
                self.pending = 'menu' if self.mode == 'menu' else self.next_piece()
            elif (self.mode == 'play' and self.pending is None and
                  time.monotonic() - self.started > max(75.0, self.secs) - 1.0):
                self.pending = self.next_piece()
            if self.pending is not None:
                self.request(self.pending)
                if self.pending in self.ready:
                    if self.ready[self.pending] is None or self.start(self.pending):
                        self.pending = None
                        self.fade = 2.5
                        if self.mode == 'play':         # заранее готовим следующую
                            self.request(self.order[(self.idx + 1) % len(self.order)])
        # военный слой следует за накалом (быстро нарастает, медленно спадает)
        target = min(1.0, intensity)
        k = 1 - np.exp(-dt / (0.8 if target > self.war else 6.0))
        self.war += (target - self.war) * k
        step = dt / max(0.05, self.fade)
        for i, (cb, cw) in enumerate(self.chs):
            lv = self.lvl[i]
            lv = min(self.tgt[i], lv + step) if self.tgt[i] > lv else max(self.tgt[i], lv - step)
            self.lvl[i] = lv
            if lv <= 0 and self.tgt[i] <= 0:
                if cb.get_busy():
                    cb.stop()
                    cw.stop()
                continue
            g = lv * lv * self.volume
            cb.set_volume(g * (1 - 0.15 * self.war))
            cw.set_volume(g * 0.9 * self.war)

    pending = None
    secs = 60.0
    fade = 2.5
