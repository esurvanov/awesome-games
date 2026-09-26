"""Reference values from CPython for web/tests/test_py.mjs (run: .venv/bin/python web/tests/gen_py_ref.py)."""
import heapq
import json
import os
import random

out = {}

def rnd_case(seed):
    r = random.Random(seed)
    d = {}
    d['random'] = [r.random() for _ in range(5)]
    d['randint'] = [r.randint(1, 100) for _ in range(5)]
    d['randrange'] = [r.randrange(10) for _ in range(3)] + [r.randrange(5, 50, 5), r.randrange(-10, 10), r.randrange(100, 0, -7)]
    d['choice'] = [r.choice('abcdefg') for _ in range(4)]
    lst = list(range(10)); r.shuffle(lst); d['shuffle'] = lst
    d['sample_small'] = r.sample(range(10), 3)
    d['sample_big'] = r.sample(range(1000), 7)
    d['uniform'] = [r.uniform(2, 5) for _ in range(3)]
    d['gauss'] = [r.gauss() for _ in range(3)] + [r.gauss(10, 2)]
    d['choices_w'] = r.choices(['a', 'b', 'c'], [1, 2, 3], k=5)
    d['choices'] = r.choices(['x', 'y', 'z', 'w'], k=4)
    d['bits40'] = r.getrandbits(40)
    d['bits70'] = str(r.getrandbits(70))
    d['big_randint'] = r.randint(0, 10**12)
    st = r.getstate()
    d['state_tail'] = list(st[1][-3:])
    d['after'] = r.random()
    return d

seeds = [0, 1, 42, 3, 7919 * 5 + 13, 12345678901234, -5, 2**40 + 7, 'castle', 'kind', 'Ab']
out['random'] = {repr(s): rnd_case(s) for s in seeds}
out['random_seeds'] = [repr(s) for s in seeds]

# setstate round trip
r = random.Random(99)
[r.random() for _ in range(700)]
st = r.getstate()
out['state'] = {'mt': list(st[1]), 'next': [r.random() for _ in range(3)]}

fmts = [(3.14159, '.2f'), (2.5, '.0f'), (3.5, '.0f'), (-2.5, '.0f'), (0.125, '.2f'), (2.675, '.2f'), (1234567, ','),
        (1234567.891, ',.1f'), (42, '05d'), (-42, '05d'), (7, '>4'), (7, '<4'), (7, '^5'), ('ab', '>5'), ('ab', '*^6'),
        (0.5, '.0%'), (0.123, '.1%'), (255, 'x'), (255, '#X'), (5, 'b'), (12345.678, 'e'), (0.000123, '.3g'), (123456789.0, 'g'),
        (1.5, ''), (3, '+d'), (3.0, '.1f'), (1e20, '.3g'), (100.0, 'g'), (0.0001, 'g'), (-0.0, '.1f'), (99.95, '.1f'),
        (1.25, '.1f'), (1.35, '.1f'), (12, '3d'), (5, ' d'), (1234.5, '_.1f'), (2.0, '.3'), (2.25, '.3'), (0.1, '.2')]
out['format'] = [[x, s, format(x, s)] for x, s in fmts]
out['round'] = [[x, n, round(x, n) if n is not None else round(x)] for x, n in
                [(2.5, None), (3.5, None), (-2.5, None), (-3.5, None), (0.5, None), (1.5, None), (2.4999, None), (-0.4, None),
                 (0.125, 2), (2.675, 2), (1234.5678, -2), (1.005, 2), (0.285, 2), (2.5, 0), (7.45, 1)]]
out['repr'] = [[x, repr(x)] for x in [1e16, 1e-5, 0.1 + 0.2, 123.0, -0.0, 1.5e300, 1e15, 123456789012345.6, 0.0001, 5e-324, 1/3]]
out['strformat'] = [
    ['{} and {}', ['a', 3], {}, '{} and {}'.format('a', 3)],
    ['{0}{1}{0}', ['x', 'y'], {}, '{0}{1}{0}'.format('x', 'y')],
    ['{name}: {n:.1f}', [], {'name': 'Gold', 'n': 2.25}, '{name}: {n:.1f}'.format(name='Gold', n=2.25)],
    ['{{literal}} {v:>3}', [], {'v': 7}, '{{literal}} {v:>3}'.format(v=7)],
    ['{v!r}', [], {'v': 'q'}, '{v!r}'.format(v='q')],
]
out['percent'] = [
    ['%d/%d', [3, 7], '%d/%d' % (3, 7)], ['%5.1f%%', [12.345], '%5.1f%%' % (12.345,)], ['%s-%s', ['a', 'b'], '%s-%s' % ('a', 'b')],
    ['%-4s|', ['ab'], '%-4s|' % ('ab',)], ['%03d', [7], '%03d' % 7], ['%+d', [5], '%+d' % 5], ['%x', [255], '%x' % 255],
]
data = [(3, 'c'), (1, 'a'), (2, 'b'), (1, 'z'), (3, 'a'), (2, 'a')]
out['sorted'] = {
    'plain': sorted(data), 'key0': sorted(data, key=lambda t: t[0]), 'key0_rev': sorted(data, key=lambda t: t[0], reverse=True),
    'rev': sorted(data, reverse=True), 'strs': sorted(['b', 'B', 'a', 'Ä', 'ab', '']),
}
out['data'] = data
h = []
seq = [(5, 1, 'a'), (3, 2, 'b'), (5, 0, 'c'), (1, 9, 'd'), (3, 1, 'e'), (8, 8, 'f'), (1, 1, 'g'), (5, 1, 'h')]
for x in seq:
    heapq.heappush(h, x)
out['heap_seq'] = seq
out['heap_order'] = [heapq.heappop(h) for _ in range(len(seq))]
hh = [9, 4, 7, 1, 8, 2, 2, 6]
heapq.heapify(hh)
out['heapify'] = hh
out['divmod'] = [[a, b, a // b, a % b] for a, b in [(7, 2), (-7, 2), (7, -2), (-7, -2), (7.5, 2), (-7.5, 2), (0, 3), (5, 5)]]
out['split'] = [[s, sep, n, s.split(sep, n)] for s, sep, n in [(' a  b c ', None, -1), ('a,b,,c', ',', -1), ('a b c d', None, 2),
                                                               ('a,b,c', ',', 1), ('', None, -1), ('  x  ', None, 1)]]
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'py_ref.json')
with open(path, 'w') as f:
    json.dump(out, f)
print('wrote', path)
