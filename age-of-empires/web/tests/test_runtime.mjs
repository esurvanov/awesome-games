// node --test web/tests/test_*.mjs  — Rect (pygame-ce semantics), np subset, pickle graph round-trip, key names
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pygame from '../runtime/pygame.js';
import * as np from '../runtime/np.js';
import * as pickle from '../runtime/pickle.js';
import * as py from '../runtime/py.js';

const { Rect } = pygame;
const R = (...a) => [...new Rect(...a)];

test('Rect construction and truncation', () => {
    assert.deepEqual(R(1.9, 2.1, 3.7, -4.2), [1, 2, 3, -4]);
    assert.deepEqual(R([1, 2], [3, 4]), [1, 2, 3, 4]);
    assert.deepEqual(R([5, 6, 7, 8]), [5, 6, 7, 8]);
    assert.deepEqual(R(new Rect(1, 2, 3, 4)), [1, 2, 3, 4]);
    assert.deepEqual(R({ rect: [9, 9, 1, 1] }), [9, 9, 1, 1]);
    const r = new Rect(10, 20, 31, 41);
    assert.deepEqual(r.center, [25, 40]);
    r.center = [100, 100];
    assert.deepEqual([...r], [85, 80, 31, 41]);
    r.right = 50; r.bottom = 60;
    assert.deepEqual(r.topleft, [19, 19]);
    r.midbottom = [0, 0];
    assert.deepEqual([...r], [-15, -41, 31, 41]);
    assert.equal(r[2], 31);
    assert.equal(py.bool(new Rect(0, 0, 0, 5)), false);
    assert.equal(py.bool(new Rect(0, 0, 1, 5)), true);
    assert.ok(py.eq(new Rect(1, 2, 3, 4), [1, 2, 3, 4]));
});

test('Rect geometry (values checked against pygame-ce)', () => {
    const a = new Rect(0, 0, 10, 10);
    assert.deepEqual([...a.inflate(4, -3)], [-2, 1, 14, 7]);
    assert.deepEqual([...a.inflate(-5, -5)], [2, 2, 5, 5]);
    assert.deepEqual([...a.move(3, -2)], [3, -2, 10, 10]);
    assert.deepEqual([...a.clip(new Rect(5, 5, 10, 10))], [5, 5, 5, 5]);
    assert.deepEqual([...a.clip(new Rect(20, 20, 5, 5))], [0, 0, 0, 0]);
    assert.deepEqual([...a.union(new Rect(5, 5, 10, 10))], [0, 0, 15, 15]);
    assert.deepEqual([...new Rect(0, 0, 4, 4).clamp(new Rect(10, 10, 20, 20))], [10, 10, 4, 4]);
    assert.deepEqual([...new Rect(0, 0, 40, 4).clamp(new Rect(10, 10, 20, 20))], [0, 10, 40, 4]);
    assert.deepEqual([...new Rect(0, 0, 100, 50).fit(new Rect(0, 0, 20, 20))], [0, 5, 20, 10]);
    assert.ok(a.collidepoint(0, 0));
    assert.ok(a.collidepoint([9, 9]));
    assert.ok(!a.collidepoint(10, 5));
    assert.ok(a.colliderect(new Rect(9, 9, 5, 5)));
    assert.ok(!a.colliderect(new Rect(10, 0, 5, 5)));
    assert.ok(!a.colliderect(new Rect(5, 5, 0, 5)));
    assert.ok(a.contains(new Rect(2, 2, 3, 3)));
    assert.ok(!a.contains(new Rect(8, 8, 3, 3)));
    assert.deepEqual(a.collidelistall([[20, 20, 1, 1], [5, 5, 1, 1], [0, 0, 10, 10]]), [1, 2]);
    assert.equal(a.collidelist([[20, 20, 1, 1], [5, 5, 1, 1]]), 1);
    const n = new Rect(10, 10, -4, -6);
    n.normalize();
    assert.deepEqual([...n], [6, 4, 4, 6]);
    const g = new Rect(0, 0, 10, 10);
    const got = g.get_rect ? null : 1;
    assert.equal(got, 1);
});

test('key names and codes (pygame compat names)', () => {
    assert.equal(pygame.key.name(pygame.K_a), 'a');
    assert.equal(pygame.key.name(pygame.K_F10), 'f10');
    assert.equal(pygame.key.name(pygame.K_KP_MINUS), '[-]');
    assert.equal(pygame.key.name(pygame.K_SPACE), 'space');
    assert.equal(pygame.key.name(pygame.K_PERIOD), '.');
    assert.equal(pygame.key.key_code('f3'), pygame.K_F3);
    assert.equal(pygame.key.key_code('[+]'), pygame.K_KP_PLUS);
    assert.equal(pygame.key.key_code('='), pygame.K_EQUALS);
    assert.equal(pygame.key.key_code('pause'), pygame.K_PAUSE);
    assert.equal(pygame.K_F1, 1073741882);
    assert.equal(pygame.K_UP, 1073741906);
    assert.equal(pygame.K_KP_ENTER, 1073741912);
    assert.equal(pygame.KEYDOWN, 768);
    assert.equal(pygame.MOUSEBUTTONDOWN, 1025);
    assert.equal(pygame.BLEND_RGBA_MULT, 8);
    assert.equal(pygame.SRCALPHA, 65536);
});

test('Vector2', () => {
    const v = new pygame.Vector2(0, -10).rotate(90);
    assert.deepEqual([v.x, v.y], [10, 0]);
    assert.equal(new pygame.Vector2([3, 4]).sub([0, 0]).length(), 5);
});

test('np: broadcasting, slicing views, reductions, fft', () => {
    const a = np.arange(6).reshape(2, 3);
    const b = np.add(a, np.array([10, 20, 30]));
    assert.deepEqual(b.tolist(), [[10, 21, 32], [13, 24, 35]]);
    const col = np.multiply(np.arange(3, null, 1, 'float64').s(null, '+'), np.array([1, 2]));
    assert.deepEqual(col.tolist(), [[0, 0], [1, 2], [2, 4]]);
    const x = np.zeros(10);
    x.s([7, null]).assign(np.linspace(1, 0, 3));
    assert.deepEqual(Array.from(x.data), [0, 0, 0, 0, 0, 0, 0, 1, 0.5, 0]);
    assert.equal(np.max(np.abs(np.array([-3, 2]))), 3);
    assert.deepEqual(np.sum(a, 0).tolist(), [3, 5, 7]);
    assert.deepEqual(a.T.tolist(), [[0, 3], [1, 4], [2, 5]]);
    assert.deepEqual(np.clip(np.array([-1, 0.5, 2]), 0, 1).tolist(), [0, 0.5, 1]);
    assert.deepEqual(np.where(np.greater(np.array([1, 5, 3]), 2), 1, 0).tolist(), [0, 1, 1]);
    assert.deepEqual(np.tile(np.array([1, 2]), 3).tolist(), [1, 2, 1, 2, 1, 2]);
    assert.deepEqual(np.stack([np.array([1, 2]), np.array([3, 4])], 1).tolist(), [[1, 3], [2, 4]]);
    assert.deepEqual(np.cumsum(np.array([1, 2, 3])).tolist(), [1, 3, 6]);
    assert.deepEqual(np.maximum.accumulate(np.array([[1, 5], [3, 2], [2, 9]]), 0).tolist(), [[1, 5], [3, 5], [3, 9]]);
    assert.deepEqual(np.interp(np.array([0.5, 1.5]), [0, 1, 2], [0, 10, 0]).tolist(), [5, 5]);
    assert.deepEqual(np.array([1.7, -1.7, 300]).astype('uint8').tolist(), [1, 255, 44]);
    // FFT round trip, any length (Bluestein) and power of two
    for (const n of [8, 12, 45, 100]) {
        const sig = np.sin(np.multiply(np.arange(n, null, 1, 'float64'), 0.3));
        const X = np.fft.rfft(sig);
        const back = np.fft.irfft(X, n);
        for (let i = 0; i < n; i++) assert.ok(Math.abs(back.data[i] - sig.data[i]) < 1e-9, `fft n=${n}`);
    }
    // rfft of a DC signal
    const X = np.fft.rfft(np.ones(6));
    assert.ok(Math.abs(X.re[0] - 6) < 1e-12 && Math.abs(X.re[1]) < 1e-12);
    assert.deepEqual(np.fft.rfftfreq(8, 0.5).tolist(), [0, 0.25, 0.5, 0.75, 1]);
    const g = np.random.default_rng(3);
    const u = g.standard_normal(4);
    assert.equal(u.shape[0], 4);
    assert.deepEqual(np.random.default_rng(3).standard_normal(4).tolist(), u.tolist());
});

test('pickle: shared refs, cycles, classes, Map/Set/TDict, typed arrays, persistent ids', () => {
    class Unit { constructor(k) { this.kind = k; this.target = null; } hp() { return 5; } }
    class World {
        constructor() { this.units = []; this.vis = new Uint8Array([0, 1, 2, 255]); this.byid = new Map(); this.cells = new py.TDict(); this.tags = new Set(['a']); }
        __getstate__() { const d = Object.assign({}, this); delete d.cache; return d; }
        __setstate__(d) { Object.assign(this, d); this.cache = 'rebuilt'; }
    }
    py.register_class(Unit, 'world.Unit');
    py.register_class(World, 'world.World');
    const TABLE = { militia: { hp: 40 } };
    const w = new World();
    const a = new Unit('militia'), b = new Unit('archer');
    a.target = b; b.target = a;              // cycle
    a.d = TABLE.militia;                     // static table -> persistent id
    a.fn = () => 1;                          // lambda -> null
    w.units.push(a, b, a);                   // shared ref
    w.byid.set(7, a);
    w.cells.set([3, 4], b);
    w.cache = 'x';
    w.inf = Infinity;
    const text = pickle.dumps({ world: w, rnd: py.random.getstate() }, { persistent_id: o => (o === TABLE.militia ? ['T', 'UNITS', 'militia'] : null) });
    const back = pickle.loads(text, { persistent_load: pid => TABLE[pid[2]] });
    const W = back.world;
    assert.ok(W instanceof World);
    assert.equal(W.cache, 'rebuilt');
    assert.equal(W.units[0], W.units[2]);
    assert.equal(W.units[0].target.target, W.units[0]);
    assert.ok(W.units[1] instanceof Unit);
    assert.equal(W.units[1].hp(), 5);
    assert.equal(W.units[0].d, TABLE.militia);
    assert.equal(W.units[0].fn, null);
    assert.equal(W.byid.get(7), W.units[0]);
    assert.equal(W.cells.get([3, 4]), W.units[1]);
    assert.ok(W.tags.has('a'));
    assert.deepEqual(Array.from(W.vis), [0, 1, 2, 255]);
    assert.ok(W.vis instanceof Uint8Array);
    assert.equal(W.inf, Infinity);
    class Unregistered {}
    assert.throws(() => pickle.dumps(new Unregistered()), pickle.PicklingError);
});
