// node --test web/tests/test_*.mjs  — py.js against CPython reference values (fixtures/py_ref.json from gen_py_ref.py)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as py from '../runtime/py.js';

const REF = JSON.parse(fs.readFileSync(new URL('./fixtures/py_ref.json', import.meta.url)));

function seedOf(r) {
    if (r.startsWith("'")) return r.slice(1, -1);
    const n = Number(r);
    return Number.isSafeInteger(n) ? n : BigInt(r);
}

test('random.Random streams match CPython', () => {
    for (const key of REF.random_seeds) {
        const d = REF.random[key];
        const r = py.random.Random(seedOf(key));
        const got = {};
        got.random = Array.from({ length: 5 }, () => r.random());
        got.randint = Array.from({ length: 5 }, () => r.randint(1, 100));
        got.randrange = [r.randrange(10), r.randrange(10), r.randrange(10), r.randrange(5, 50, 5), r.randrange(-10, 10), r.randrange(100, 0, -7)];
        got.choice = Array.from({ length: 4 }, () => r.choice('abcdefg'));
        const lst = py.range(10); r.shuffle(lst); got.shuffle = lst;
        got.sample_small = r.sample(py.range(10), 3);
        got.sample_big = r.sample(py.range(1000), 7);
        got.uniform = Array.from({ length: 3 }, () => r.uniform(2, 5));
        got.gauss = [r.gauss(), r.gauss(), r.gauss(), r.gauss(10, 2)];
        got.choices_w = r.choices(['a', 'b', 'c'], [1, 2, 3], null, 5);
        got.choices = r.choices(['x', 'y', 'z', 'w'], null, null, 4);
        got.bits40 = r.getrandbits(40);
        got.bits70 = String(r.getrandbits(70));
        got.big_randint = r.randint(0, 10 ** 12);
        const st = r.getstate();
        got.state_tail = st[1].slice(-3);
        got.after = r.random();
        for (const k of Object.keys(d)) {
            if (k === 'gauss') {        // sin/cos/log may differ from the C libm by 1 ulp
                got[k].forEach((v, i) => assert.ok(Math.abs(v - d[k][i]) < 1e-12, `seed ${key}: gauss`));
                continue;
            }
            assert.deepEqual(got[k], d[k], `seed ${key}: ${k}`);
        }
    }
});

test('module-level random + getstate/setstate', () => {
    py.random.seed(99);
    for (let i = 0; i < 700; i++) py.random.random();
    const st = py.random.getstate();
    assert.deepEqual(st[1], REF.state.mt);
    const next = [py.random.random(), py.random.random(), py.random.random()];
    assert.deepEqual(next, REF.state.next);
    py.random.setstate(st);
    assert.equal(py.random.random(), REF.state.next[0]);
    const r2 = new py.random.Random(5);          // with `new` too
    assert.equal(typeof r2.random(), 'number');
});

test('format spec', () => {
    for (const [x, spec, want] of REF.format) assert.equal(py.fmt(x, spec), want, `format(${x}, '${spec}')`);
});

test('round half-even', () => {
    for (const [x, n, want] of REF.round) assert.equal(py.round(x, n), want, `round(${x}, ${n})`);
});

test('float repr', () => {
    for (const [x, want] of REF.repr) assert.equal(py.float_repr(x), want, `repr(${x})`);
    assert.equal(py.str(3), '3');
    assert.equal(py.float_str(3), '3.0');
    assert.equal(py.str(null), 'None');
    assert.equal(py.repr(['a', 1, [true, null]]), "['a', 1, [True, None]]");
});

test('str.format and % formatting', () => {
    for (const [tpl, args, kw, want] of REF.strformat) assert.equal(py.format(tpl, args, kw), want, tpl);
    for (const [tpl, args, want] of REF.percent) assert.equal(py.percent(tpl, args), want, tpl);
});

test('sorted / stability / reverse / tuple compare', () => {
    const data = REF.data;
    assert.deepEqual(py.sorted(data), REF.sorted.plain);
    assert.deepEqual(py.sorted(data, t => t[0]), REF.sorted.key0);
    assert.deepEqual(py.sorted(data, t => t[0], true), REF.sorted.key0_rev);
    assert.deepEqual(py.sorted(data, null, true), REF.sorted.rev);
    assert.deepEqual(py.sorted(['b', 'B', 'a', 'Ä', 'ab', '']), REF.sorted.strs);
    assert.deepEqual(py.min([[2, 'b'], [1, 'z'], [1, 'a']]), [1, 'a']);
    assert.deepEqual(py.max([3, 7, 7, 1], x => x), 7);
    assert.equal(py.max([], null, 'dflt'), 'dflt');
});

test('heapq matches CPython order', () => {
    const h = [];
    for (const x of REF.heap_seq) py.heappush(h, x);
    const got = REF.heap_seq.map(() => py.heappop(h));
    assert.deepEqual(got, REF.heap_order);
    const hh = [9, 4, 7, 1, 8, 2, 2, 6];
    py.heapify(hh);
    assert.deepEqual(hh, REF.heapify);
});

test('floor division / modulo / divmod', () => {
    for (const [a, b, q, m] of REF.divmod) {
        assert.equal(py.floordiv(a, b), q, `${a}//${b}`);
        assert.equal(py.mod(a, b), m, `${a}%${b}`);
    }
    assert.throws(() => py.floordiv(1, 0), py.ZeroDivisionError);
});

test('split', () => {
    for (const [s, sep, n, want] of REF.split) assert.deepEqual(py.split(s, sep, n), want, JSON.stringify([s, sep, n]));
});

test('containers: TDict/TSet/Counter/DefaultMap, eq, contains, truthiness', () => {
    const d = new py.TDict();
    d.set([1, 2], 'a').set([3, 4], 'b');
    assert.equal(d.get([1, 2]), 'a');
    assert.ok(d.has([3, 4]));
    assert.deepEqual(Array.from(d.keys()), [[1, 2], [3, 4]]);
    const s = new py.TSet([[1, 1], [1, 1], [2, 'x']]);
    assert.equal(s.size, 2);
    const c = new py.Counter(['a', 'b', 'a', 'c', 'b', 'a']);
    assert.deepEqual(c.most_common(2), [['a', 3], ['b', 2]]);
    assert.equal(c.get('zzz'), 0);
    const dm = new py.DefaultMap(() => []);
    dm.get('k').push(1);
    assert.deepEqual(dm.get('k'), [1]);
    assert.ok(py.eq([1, [2, 3]], [1, [2, 3]]));
    assert.ok(py.eq(1, true));
    assert.ok(!py.eq([1, 2], [1, 2, 3]));
    assert.ok(py.contains([[1, 2], [3, 4]], [3, 4]));
    assert.ok(py.contains({ a: 1 }, 'a'));
    assert.ok(!py.contains({ a: 1 }, 'toString'));
    assert.equal(py.bool([]), false);
    assert.equal(py.bool({}), false);
    assert.equal(py.bool(new Map()), false);
    assert.equal(py.bool(NaN), true);
    assert.equal(py.bool(0), false);
    assert.deepEqual(py.slice([0, 1, 2, 3, 4, 5], null, null, -2), [5, 3, 1]);
    assert.deepEqual(py.slice([0, 1, 2, 3], -2), [2, 3]);
    assert.equal(py.slice('hello', null, null, -1), 'olleh');
    assert.equal(py.get({ a: null }, 'a', 5), null);
    assert.equal(py.get({}, 'a', 5), 5);
    assert.equal(py.getattr({ a: null }, 'a', 5), null);
});

test('mixin: C3 MRO, class attrs, super_method', () => {
    class SettingsUI { draw_help() { return 'settings'; } a() { return 'S'; } }
    class SavesUI { b() { return 'V'; } }
    class ScreensUI {
        draw_help() { return 'screens+' + py.super_method(ScreensUI, this, 'draw_help')(); }
        a() { return 'Sc'; }
    }
    py.classattrs(ScreensUI, { load_step: 0, stats_tab: 'score' });
    py.mixin(ScreensUI, SettingsUI, SavesUI);
    class HudUI { draw_help() { return 'hud'; } c() { return 'H'; } }
    class Game { c() { return 'G'; } }
    py.mixin(Game, ScreensUI, HudUI);
    const g = new Game();
    assert.deepEqual(Game.__mro__.map(c => c.name), ['Game', 'ScreensUI', 'SettingsUI', 'SavesUI', 'HudUI']);
    assert.equal(g.a(), 'Sc');
    assert.equal(g.b(), 'V');
    assert.equal(g.c(), 'G');
    assert.equal(g.load_step, 0);
    g.load_step += 1;
    assert.equal(g.load_step, 1);
    assert.equal(new Game().load_step, 0);
    assert.equal(g.draw_help(), 'screens+settings');
});

test('os.path', () => {
    assert.equal(py.os.path.join('assets', 'gen', 'x.png'), 'assets/gen/x.png');
    assert.equal(py.os.path.join('web/..', 'assets', 'gen'), 'assets/gen');
    assert.equal(py.os.path.join('', 'assets'), 'assets');
    assert.equal(py.os.path.dirname('a/b/c.json'), 'a/b');
    assert.equal(py.os.path.basename('a/b/c.json'), 'c.json');
    assert.deepEqual(py.os.path.splitext('a/b/c.tar.gz'), ['a/b/c.tar', '.gz']);
    assert.equal(py.os.path.relpath('assets/ui/portraits/de/x', 'assets/ui/portraits'), 'de/x');
});
