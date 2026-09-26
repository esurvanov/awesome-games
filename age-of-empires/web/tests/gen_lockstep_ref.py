#!/usr/bin/env python3
"""Reference digests for web/tests/test_lockstep.mjs: whole AI-vs-AI matches (World + AI, as tools/sim.py) run in
CPython; every STEP-th simulation step the full state digest (random stream, every unit's exact coordinates,
resources) is hashed. The JS port must reproduce every hash - the simulation and the AI are bit-identical.

Transcendental functions (sin, cos, atan2, exp, ...) are not correctly rounded in the C library nor in V8 and differ
by one ulp now and then; both sides round their results to float32 for this test (see f32 below and
test_lockstep.mjs), which removes that noise and leaves every other operation exact.

  SDL_VIDEODRIVER=dummy .venv/bin/python web/tests/gen_lockstep_ref.py      (from the repository root; ~5 minutes)
"""
import hashlib
import json
import math
import os
import random
import struct
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ['KHRONIKI_LANG'] = 'en'


def _f32(fn):
    return lambda *a: struct.unpack('f', struct.pack('f', fn(*a)))[0]


for _n in ('sin', 'cos', 'tan', 'atan2', 'atan', 'exp', 'log', 'log2', 'log10', 'acos', 'asin', 'sinh', 'cosh',
           'tanh', 'log1p', 'expm1'):
    setattr(math, _n, _f32(getattr(math, _n)))

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from sim import make_world  # noqa: E402

STEP = 150          # digest every STEP simulation steps (0.034 s each)
# (name, seed, players, mode, difficulty, map, steps)
SCENARIOS = [
    ('arabia_1v1', 1, 2, 'ai', 1, 'arabia', 42000),
    ('islands_ffa3', 8, 3, 'ai', 2, 'islands', 30000),
    ('black_forest_2v2', 11, 4, 'teams', 1, 'black_forest', 30000),
]


def F(v):
    r = repr(float(v))
    return r[:-2] if r.endswith('.0') else r


def digest(w):
    st = random.getstate()[1]
    rs = (sum(st[:624]) + st[624] * 7) % 4294967296
    ux = ';'.join(f'{u.kind}:{F(u.x)},{F(u.y)},{F(u.hp)}' for u in w.units)
    res = ','.join(F(round(v, 3)) for p in w.players for v in p.res.values())
    return f'{rs}|{len(w.units)}|{len(w.buildings)}|{ux}|{res}'


def run(seed, n, mode, diff, mp, steps):
    random.seed(seed)
    w = make_world(n, mode, diff, mp, ['random'])
    out = []
    for i in range(steps):
        w.update(0.034)
        w.events.clear()
        if i % STEP == 0:
            out.append(hashlib.md5(digest(w).encode()).hexdigest()[:12])
        if w.winner is not None:
            break
    return out, w.time


def main():
    ref = {'step': STEP, 'scenarios': []}
    for name, seed, n, mode, diff, mp, steps in SCENARIOS:
        hashes, t = run(seed, n, mode, diff, mp, steps)
        print(f'{name}: {len(hashes)} digests, {t / 60:.1f} game minutes')
        ref['scenarios'].append(dict(name=name, seed=seed, players=n, mode=mode, diff=diff, map=mp, steps=steps,
                                     hashes=hashes))
    path = os.path.join(ROOT, 'web', 'tests', 'fixtures', 'lockstep_ref.json')
    with open(path, 'w') as f:
        json.dump(ref, f, indent=0)
    print('wrote', path)


if __name__ == '__main__':
    main()
