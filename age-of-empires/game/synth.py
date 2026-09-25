"""Procedural sound synthesis on numpy: envelopes, filters, reverb and "instruments".

Everything is generated from formulas - no sound files. Signals are mono/stereo float32 arrays
in the range [-1, 1] with the sampling rate SR (set to the mixer via set_rate)."""
import numpy as np

SR = 44100
TAU = 2 * np.pi


def set_rate(sr):
    global SR
    SR = int(sr)


def n_of(dur):
    return max(1, int(round(dur * SR)))


def tvec(n):
    return np.arange(n, dtype=np.float64) / SR


def midi_hz(m):
    return 440.0 * 2.0 ** ((m - 69) / 12.0)


def rng(seed):
    return np.random.default_rng(seed)


# ============================================================ envelopes
def ramp(n, a, r):
    """A plateau with smooth (sin^2) attack a and release r (in seconds)."""
    e = np.ones(n)
    na, nr = min(n, n_of(a)), min(n, n_of(r))
    if na > 1:
        e[:na] = np.sin(np.linspace(0, np.pi / 2, na)) ** 2
    if nr > 1:
        e[n - nr:] *= np.cos(np.linspace(0, np.pi / 2, nr)) ** 2
    return e


def perc(n, tau, attack=0.002):
    """A strike: fast attack, an exponential decay with the constant tau."""
    e = np.exp(-tvec(n) / tau)
    na = min(n, n_of(attack))
    if na > 1:
        e[:na] *= np.linspace(0, 1, na)
    return e


def tail(x, r=0.01):
    """Fades the last r seconds - no click at the end."""
    nr = min(len(x), n_of(r))
    if nr > 1:
        x[len(x) - nr:] *= np.linspace(1, 0, nr)
    return x


# ============================================================ filters (in the frequency domain)
def fast_len(n):
    """The nearest length above of the form 2^a*3^b*5^c - the FFT at it is fast."""
    best = 1 << (int(n - 1).bit_length())
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            p = p35
            while p < n:
                p *= 2
            best = min(best, p)
            p35 *= 3
        p5 *= 5
    return best


def spectral(x, gain, pad=0.25, circular=False):
    """A filter via FFT: gain(freqs) -> an amplitude response.
    circular=True - circular convolution (for seamless music loops)."""
    m = len(x)
    size = m if circular else fast_len(m + int(m * pad) + 256)
    X = np.fft.rfft(x, size)
    f = np.fft.rfftfreq(size, 1.0 / SR)
    return np.fft.irfft(X * gain(f), size)[:m]


def lp(fc, order=2):
    return lambda f: 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))


def hp(fc, order=2):
    return lambda f: 1.0 / np.sqrt(1.0 + (fc / np.maximum(f, 1e-3)) ** (2 * order))


def bp(fc, bw=1.0):
    """A band around fc about bw octaves wide (Gaussian in the logarithm of the frequency)."""
    return lambda f: np.exp(-(np.log2(np.maximum(f, 1.0) / fc) / (bw * 0.6)) ** 2)


def band(lo, hi, order=2):
    a, b = hp(lo, order), lp(hi, order)
    return lambda f: a(f) * b(f)


def formant(peaks):
    """A sum of resonances [(frequency, width in octaves, gain)] - a "vowel"."""
    def g(f):
        out = np.zeros_like(f)
        for fc, bw, k in peaks:
            out += k * np.exp(-(np.log2(np.maximum(f, 1.0) / fc) / (bw * 0.6)) ** 2)
        return out
    return g


# ============================================================ sources
def noise(n, r):
    return r.standard_normal(n)


def brown(n, r):
    """'Brown' noise - dull, for rumble."""
    x = spectral(r.standard_normal(n), lambda f: 1.0 / np.maximum(f, 20.0))
    return x / (np.abs(x).max() + 1e-9)


def phase_of(freq, n):
    """Phase for a constant or varying (array) frequency."""
    if np.isscalar(freq):
        return TAU * freq * tvec(n)
    return TAU * np.cumsum(freq) / SR


def harmonic(freq, n, amps, env=None, bright=None):
    """An additive tone: sum a_k*sin(k*phi). bright - the power to which the envelope
    enters the upper harmonics (louder -> brighter, like brass)."""
    ph = phase_of(freq, n)
    f0 = freq if np.isscalar(freq) else float(np.max(freq))
    out = np.zeros(n)
    for k, a in enumerate(amps, 1):
        if a == 0 or k * f0 > SR * 0.45:
            continue
        s = a * np.sin(k * ph)
        if env is not None and bright:
            s *= env ** (bright * (k - 1))
        out += s
    return out if env is None else out * env


def glide(f_from, f_to, n, tau):
    """A frequency sliding exponentially from f_from to f_to (tau - seconds)."""
    return f_to + (f_from - f_to) * np.exp(-tvec(n) / tau)


# ============================================================ space
def reverb_ir(dur, seed, damp=3500.0, pre=0.012):
    r = rng(seed)
    n = n_of(dur)
    ir = r.standard_normal(n) * np.exp(-tvec(n) * 6.9 / dur)
    ir = spectral(ir, lp(damp, 1))
    ir[:n_of(pre)] = 0
    return ir / np.sqrt(np.sum(ir ** 2) + 1e-12)


def reverb(x, dur=1.2, wet=0.2, seed=7, circular=False, damp=3500.0):
    """Mono -> stereo (n, 2) with reverb; for loops - circular convolution."""
    m = len(x)
    size = m if circular else fast_len(m + n_of(dur) + 256)
    X = np.fft.rfft(x, size)
    out = []
    for s in (seed, seed + 1):
        ir = reverb_ir(min(dur, size / SR * 0.9), s, damp)
        y = np.fft.irfft(X * np.fft.rfft(ir, size), size)
        y = y if circular else y[:m + n_of(dur)]
        out.append(y)
    dry = np.zeros(len(out[0]))
    dry[:m] = x
    return np.stack([dry + wet * out[0], dry + wet * out[1]], axis=1)


def normalize(x, peak):
    mx = float(np.abs(x).max())
    return x * (peak / mx) if mx > 1e-9 else x


def mix(parts, n=None):
    """Sum signals [(offset_sec, signal, volume)] into one mono buffer."""
    if n is None:
        n = max(n_of(off) + len(s) for off, s, _ in parts)
    out = np.zeros(n)
    for off, s, g in parts:
        i = n_of(off) if off > 0 else 0
        j = min(n, i + len(s))
        out[i:j] += g * s[:j - i]
    return out


# ============================================================ instruments
_memo = {}


def pluck(freq, dur, bright=0.5, seed=0):
    """A plucked string (lute/harp): harmonics with decreasing amplitudes and faster-decaying
    upper ones, a double course (two slightly detuned strings) and a pick "click"."""
    key = ('pl', round(freq, 2), round(dur, 3), bright, seed)
    s = _memo.get(key)
    if s is not None:
        return s
    n = n_of(dur)
    t = tvec(n)
    r = rng(seed + int(freq))
    p = 0.14 + 0.06 * bright
    tau0 = 1.6 * (220.0 / freq) ** 0.35
    out = np.zeros(n)
    for k in range(1, 15):
        fk = k * freq * np.sqrt(1 + 0.00012 * k * k)
        if fk > SR * 0.45:
            break
        a = abs(np.sin(np.pi * k * p)) / k ** (1.7 - 0.7 * bright)
        tk = tau0 / (1 + 0.45 * (k - 1) * (1.2 - bright))
        ph = r.uniform(0, TAU)
        e = np.exp(-t / tk)
        out += a * e * np.sin(TAU * fk * t + ph)
        if k <= 3:
            out += 0.5 * a * e * np.sin(TAU * fk * 1.0015 * t + ph + 1.3)
    na = n_of(0.003)
    out[:na] *= np.linspace(0, 1, na)
    nz = min(n, n_of(0.02))
    click = spectral(r.standard_normal(nz), bp(min(freq * 6, 5000), 1.5)) * perc(nz, 0.004)
    out[:nz] += 0.15 * click
    out = tail(out, 0.04)
    _memo[key] = out
    return out


def recorder(freq, dur, seed=0, vib=True):
    """A recorder: an almost pure tone with light 2nd-3rd harmonics, breath and a "chiff" in the attack."""
    key = ('rec', round(freq, 2), round(dur, 3), seed, vib)
    s = _memo.get(key)
    if s is not None:
        return s
    n = n_of(dur + 0.06)
    t = tvec(n)
    r = rng(seed + int(freq) * 3)
    f = np.full(n, float(freq))
    if vib and dur > 0.3:
        depth = np.clip((t - 0.18) / 0.3, 0, 1) * 0.0045
        f *= 1 + depth * np.sin(TAU * 5.1 * t + r.uniform(0, TAU))
    ph = phase_of(f, n)
    tone = np.sin(ph) + 0.16 * np.sin(2 * ph) + 0.09 * np.sin(3 * ph) + 0.025 * np.sin(4 * ph)
    breath = spectral(r.standard_normal(n), bp(freq * 2.2, 1.2)) * 0.035
    env = ramp(n, 0.035, 0.07)
    nz = min(n, n_of(0.03))
    chiff = np.zeros(n)
    chiff[:nz] = spectral(r.standard_normal(nz), bp(freq * 4, 1.0)) * perc(nz, 0.008)
    out = (tone + breath) * env + 0.12 * chiff
    _memo[key] = out
    return out


def brass(freq, dur, seed=0, bright=0.6, scoop=0.03, vib=0.004):
    """A brass wind (horn, fanfare): the harmonics brighten with loudness, a pitch scoop in the attack."""
    n = n_of(dur + 0.12)
    t = tvec(n)
    r = rng(seed + int(freq))
    f = freq * (1 - scoop * np.exp(-t / 0.035))
    if vib:
        f = f * (1 + vib * np.clip((t - 0.25) / 0.3, 0, 1) * np.sin(TAU * 4.6 * t + r.uniform(0, TAU)))
    env = ramp(n, 0.05, 0.12) * (0.82 + 0.18 * np.exp(-t / 0.12))
    amps = [1.0 / k ** 0.7 for k in range(1, 16)]
    out = harmonic(f, n, amps, env, bright=bright * 0.35)
    breath = spectral(r.standard_normal(n), bp(freq * 3, 1.5)) * env * 0.03
    return spectral(out + breath, lp(min(3200, freq * 12), 2))


def bell(freq, dur, seed=0, soft=0.0):
    """A bell/little bell: inharmonic partials, each with its own decay."""
    n = n_of(dur)
    t = tvec(n)
    r = rng(seed + int(freq))
    parts = [(0.5, 0.35, 1.0), (1.0, 1.0, 0.8), (1.19, 0.4, 0.55), (1.5, 0.3, 0.45),
             (2.0, 0.45, 0.35), (2.52, 0.2 * (1 - soft), 0.25), (3.01, 0.15 * (1 - soft), 0.18)]
    out = np.zeros(n)
    for ratio, a, tk in parts:
        fk = freq * ratio
        if fk < SR * 0.45:
            out += a * np.exp(-t / (tk * dur * 0.6)) * np.sin(TAU * fk * t + r.uniform(0, TAU))
    na = n_of(0.002)
    out[:na] *= np.linspace(0, 1, na)
    return tail(out, 0.05)


def chime(freq, dur, seed=0):
    """A bright metallophone (glockenspiel): 1 : 2.76 : 5.4."""
    n = n_of(dur)
    t = tvec(n)
    out = (np.sin(TAU * freq * t) * np.exp(-t / (dur * 0.35))
           + 0.25 * np.sin(TAU * freq * 2.76 * t) * np.exp(-t / (dur * 0.12))
           + 0.08 * np.sin(TAU * freq * 5.4 * t) * np.exp(-t / (dur * 0.05)))
    na = n_of(0.0015)
    out[:na] *= np.linspace(0, 1, na)
    return tail(out, 0.03)


def drum(f_hi=150.0, f_lo=70.0, tau=0.22, snap=0.25, seed=0, dur=None):
    """A tambourine/drum: a tone with a pitch decay + a muffled noise of the strike."""
    dur = dur or tau * 4
    n = n_of(dur)
    r = rng(seed)
    f = glide(f_hi, f_lo, n, 0.035)
    body = np.sin(phase_of(f, n)) * perc(n, tau, 0.001)
    hit = spectral(r.standard_normal(n), band(200, 2200)) * perc(n, 0.03, 0.0005)
    return tail(body + snap * hit, 0.02)


def jingle(dur=0.25, seed=0, n_hits=3):
    """Sleigh bells/cymbals: high noise in short bursts."""
    n = n_of(dur)
    r = rng(seed)
    out = np.zeros(n)
    for i in range(n_hits):
        off = n_of(i * 0.012 + r.uniform(0, 0.006))
        if off >= n:
            break
        m = n - off
        out[off:] += r.standard_normal(m) * perc(m, 0.05 + 0.02 * r.random()) * (1 - 0.25 * i)
    return tail(spectral(out, band(5000, 11000, 2)), 0.02)


def voice(f0, n, vowel, breath=0.08, seed=0):
    """An indistinct "vocal" sound (hm/ha/uh) - not speech: a harmonic tone through resonances."""
    r = rng(seed)
    f = f0 if not np.isscalar(f0) else np.full(n, float(f0))
    fmax = float(np.max(f))
    kmax = int(min(40, SR * 0.4 / fmax))
    src = harmonic(f, n, [1.0 / k ** 1.1 for k in range(1, kmax + 1)])
    src += breath * r.standard_normal(n)
    return spectral(src, formant(vowel))


VOWELS = {
    'hm': [(260, 0.6, 1.0), (2200, 0.8, 0.06)],
    'uh': [(520, 0.6, 1.0), (1050, 0.6, 0.45), (2500, 0.8, 0.12)],
    'ha': [(750, 0.6, 1.0), (1200, 0.6, 0.6), (2600, 0.8, 0.15)],
    'oh': [(430, 0.5, 1.0), (820, 0.5, 0.5), (2500, 0.8, 0.08)],
    'eh': [(550, 0.5, 1.0), (1800, 0.5, 0.45), (2600, 0.7, 0.2)],
    'baa': [(700, 0.5, 1.0), (1300, 0.5, 0.7), (2700, 0.7, 0.3)],
}


def to_pcm(x, channels=2):
    """float (n,) or (n, 2) -> int16 bytes with interleaved channels for the mixer."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[:, None]
    if x.shape[1] != channels:
        if channels == 1:
            x = x.mean(axis=1, keepdims=True)
        elif x.shape[1] == 1:
            x = np.repeat(x, channels, axis=1)
        else:
            y = np.zeros((len(x), channels))
            y[:, :2] = x[:, :2]
            x = y
    return (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
