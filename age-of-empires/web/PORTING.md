# Porting game/*.py to the browser — conventions

Read this whole file before writing code. Every porter follows it exactly, so that modules written by
different people fit together without renaming or glue.

**Goal:** the game runs as a static site (GitHub Pages style, no backend). Modern JavaScript, native ES modules,
no bundler, no npm runtime dependencies. Canvas 2D, Web Audio, saves in IndexedDB. The Python version in `game/`,
`main.py`, `assets/` stays untouched.

**Port faithfully, don't redesign.** Same module, class, function, method, attribute, constant and dict-key
names (snake_case stays snake_case). Same numbers (costs, HP, timings), same AI logic, same map generation,
same order of random calls. When in doubt, the Python source is the spec.

---

## 0. Layout, running, testing

```
web/index.html            entry page (canvas 1280x800) -> boot.js -> main.js
web/demo.html, demo.js    runtime demo (fonts, atlas sprite, tint, draw.*, input, sound)
web/boot.js               loads manifest, storage, asset groups with a progress bar, then imports the entry
web/main.js               port of main.py                                   (G9)
web/src/<m>.js            port of game/<m>.py
web/src/content/<m>.js    port of game/content/<m>.py; __init__.py -> web/src/content/__init__.js
web/src/_data_init.js     FOUNDATION: data.js -> content/__init__.js -> i18n.relabel()  (= `import game.data`)
web/src/_all.js           FOUNDATION: imports every module, fills py.modules (late-bound imports)
web/runtime/py.js         Python idioms (numbers, sorting, containers, formatting, exact random, os/time/math)
web/runtime/pygame.js     pygame-ce API on Canvas 2D / Web Audio / DOM events
web/runtime/np.js         numpy subset (strided N-d arrays, broadcasting, fft, rng)
web/runtime/assets.js     manifest + loader for assets/ (sync access after preload)
web/runtime/storage.js    synchronous user files (settings, saves) persisted to IndexedDB
web/runtime/pickle.js     object-graph serializer for saves (replaces pickle)
web/assets_manifest.json  generated: node web/tools/build_manifest.mjs  (re-run when assets/ change)
web/tests/                node tests, browser pages, fixtures from real CPython / pygame-ce
```

The **site root is the repository root** (web/ sits next to assets/). Serve the repo root:

```
cd <repo> && python3 -m http.server 8000     ->  http://localhost:8000/web/          (game)
                                              ->  http://localhost:8000/web/demo.html (runtime demo)
```
On GitHub Pages under a sub-path it works the same (`https://<user>.github.io/<repo>/web/`): every URL is
relative (`new URL('../../', import.meta.url)`).

Tests:
```
node --test web/tests/test_*.mjs                                 # py.js, Rect, np, pickle (+ your module tests)
node --import ./web/tests/stub_loader.mjs --test web/tests/test_<yours>.mjs   # deps not ported yet -> auto stubs
node web/tests/browser_check.mjs [web/tests/<yours>.html ...]  # headless Chromium: runtime self-test, demo, your pages
```
`browser_check.mjs` serves the repo root, fails on any console error, and for extra pages reads
`window.__results = {pass, fail, details: [{name, ok, got, want}]}` if the page sets it (copy the pattern of
`web/tests/runtime_selftest.js`). Screenshots go to `$SHOT_DIR` (use the scratchpad).

Reference values: the Python game runs headless (`SDL_VIDEODRIVER=dummy .venv/bin/python ...`). Generate fixtures
from real Python/pygame (see `web/tests/gen_py_ref.py`, `gen_pygame_ref.py`) and compare in your tests — e.g. seed
`random`, build a World in Python and in JS, compare the terrain grid. `random` is bit-exact (§7), so this works.

---

## 1. Module template and imports

```js
// port of game/world.py
import * as py from '../runtime/py.js';
import { math, random, modules } from '../runtime/py.js';
import * as pygame from '../runtime/pygame.js';
import * as np from '../runtime/np.js';                   // only if the Python imports numpy
import * as assets from '../runtime/assets.js';           // only for asset reads
import * as storage from '../runtime/storage.js';         // only for user files
import { TILE, UNITS, shade } from './data.js';
import * as naval from './naval.js';
import * as gsettings from './settings.js';
```
(content modules: `'../../runtime/...'`, `'../data.js'`, siblings `'./x.js'`.)

| Python | JS |
|---|---|
| `import math` / `import random` | `import { math, random } from '../runtime/py.js'` |
| `import time`, `import os` | `import { time, os } from '../runtime/py.js'` |
| `import pygame` | `import * as pygame from '../runtime/pygame.js'` |
| `import numpy as np` | `import * as np from '../runtime/np.js'` |
| `from .data import A, B` | `import { A, B } from './data.js'` |
| `from . import gfx` / `import x as y` | `import * as gfx from './gfx.js'` / `import * as y from './x.js'` |
| `from .content import _army_art as aa` | `import * as aa from './content/_army_art.js'` |
| **function-local** `from . import gfx` (inside a def) | `modules.gfx` at call time (no import statement) |
| function-local `from .x import name` | `const { name } = modules.x;` inside the function |
| `json`, `io`, `wave`, `threading`, `queue`, `subprocess`, `ctypes`, `pkgutil`, `importlib` | see §9–§12 |

- **Top-level Python imports -> static ES imports. Function-local imports -> `modules.<name>`** (registry
  filled by `web/src/_all.js`; content modules are `modules['content._army_art']` etc.). This keeps Python's
  evaluation order and avoids ES-module cycles with uninitialised bindings. In node tests register what you use:
  `py.register_modules({ gfx: await import('../src/gfx.js') })`.
- **Export every top-level name** (functions, classes, constants, `_private` ones too) with its Python name.
  Other modules import private names (`from ._uni import PENDING`).
- Module-level mutable globals (`global _atlas`) -> `export let _atlas = null;` reassigned inside functions.
  Importers see the live value but cannot assign it. The codebase only mutates other modules' objects in place
  (`data.AGE_NAMES[:] = ...` -> `data.AGE_NAMES.splice(0, data.AGE_NAMES.length, ...vals)`), which works.
- Never read content-extended tables (UNITS, BUILDINGS, TECHS, CIVS, NODE_DEFS, ANIMALS, BUILD_MENU...) at module
  top level unless Python does too; if Python does (e.g. `naval.FISH`), keep it — `_all.js` imports
  `_data_init.js` first, so content is registered before any other game module evaluates.
- `if __name__ == '__main__':` blocks, `__all__`, `# noqa` hacks, `os.environ.setdefault('PYGAME_...')`: drop.

---

## 2. Functions: THE kwargs rule

**Every Python parameter becomes one JS positional parameter, at the same position, with the same name and the
same default.** (Python default `None` -> `null`; tuple default `(1, 2)` -> `[1, 2]`.)

- Keyword-only parameters (after a bare `*`) follow in declared order, positionally.
- `*args` -> rest parameter `...args` (always last; this codebase never has parameters after `*args`).
- `**kw` -> the last parameter, a plain object named as in Python, default `{}`.
- `self` disappears (`this`).

**Call sites:** positional arguments stay as they are. **Each keyword argument goes to the position of the
parameter with that name; skipped positions are filled with `undefined`** (so the JS default applies — exactly
Python's behaviour). Keyword arguments that match no named parameter go into the callee's trailing `**kw`
object. Reading the callee's *Python* signature is always enough to write the call.

```python
def text(self, s, pos, font='m', color=(240, 235, 220), anchor='topleft', sh=True): ...
self.text(s, (x, y), 'b', anchor='center')
def t(key, **fmt): ...                          t('menu.version', v='0.9.' + n)
def add_building(key, menu=True, **d): ...      add_building('university', size=3, hp=2100, techs=[])
def add_trains(building, *units): ...           add_trains('castle', *lst)
self.make_world(**self.load_args)
```
```js
text(s, pos, font = 'm', color = [240, 235, 220], anchor = 'topleft', sh = true) { ... }
this.text(s, [x, y], 'b', undefined, 'center');
export function t(key, fmt = {}) { ... }       t('menu.version', { v: '0.9.' + n });
export function add_building(key, menu = true, d = {}) { ... }   add_building('university', undefined, { size: 3, hp: 2100, techs: [] });
export function add_trains(building, ...units) { ... }            add_trains('castle', ...lst);
const a = this.load_args;                       // ** splat into named params: expand by the callee's names
this.make_world(a.diff, a.opponents, a.ally, a.ai_human, a.map_type, a.civ, a.civs, a.teams, a.colors, a.levels, a.settings);
```
- Explicit `None` stays `null` (JS defaults apply only to `undefined` — same as Python: passing None is not
  "omitted"). Never store `undefined` in data; it is only the "argument omitted" filler.
- `dict(base, art=x, **elite)` -> `{ ...base, art: x, ...elite }`.
- Mutable defaults (`def f(x=[])`) are evaluated per call in JS; if the Python function mutates a default
  (shared across calls), make it a module-level constant.
- Lambdas -> arrow functions. Nested `def` -> arrow functions (keep `this`) or `function` declarations.
  Python closures bind loop variables late; JS `let` binds per iteration — if Python relies on late binding
  (a lambda created in a loop called later sees the *last* value), reproduce it explicitly.
- Generators (`yield`) -> `function*`.

**The pygame runtime follows the same rule** with pygame's own signatures (see §10), e.g.
`surf.blit(src, pos, null, pygame.BLEND_RGB_ADD)`, `pygame.draw.rect(s, c, r, 0, 6)`,
`surf.get_rect({ center: pos })` (get_rect takes `**kwargs`), `font.render(text, true, color)`,
`sound.play(-1)`, `pygame.mixer.music.play(loops)`, `spr.get_bounding_rect(128)`.

---

## 3. Classes

```python
class Unit:
    SPEED = 1.0                      # class attribute
    def __init__(self, kind, owner, x, y, world): ...
    @property
    def d(self): return UNITS[self.kind]
    @staticmethod
    def node_stage(n): ...
class Ship(Unit):
    def __init__(self, kind, owner, x, y, world):
        super().__init__(kind, owner, x, y, world)
```
```js
export class Unit {
    constructor(kind, owner, x, y, world) { ... }
    get d() { return UNITS[this.kind]; }
    static node_stage(n) { ... }
}
py.classattrs(Unit, { SPEED: 1.0 });           // this.SPEED and Unit.SPEED (prototype + static)
py.statics(Unit, 'node_stage');                 // this.node_stage(...) works too (Python allows it)
py.register_class(Unit, 'world.Unit');          // every class whose instances can end up in a save (§13)
export class Ship extends Unit {
    constructor(kind, owner, x, y, world) { super(kind, owner, x, y, world); ... }
}
```
- `__init__` -> `constructor`. JS forbids `this` before `super(...)`: if Python sets attributes before
  `super().__init__`, move them after (check the parent doesn't read them), or set them in the parent.
- Initialise every attribute in the constructor (in Python order); declare attributes Python creates lazily
  (`getattr(self, '_vw', SCREEN_W)`) as the lazy read `py.getattr(this, '_vw', SCREEN_W)`.
- Class attributes: `py.classattrs(Cls, {...})` right after the class. A class attribute *mutated through the
  class* (counters like `Node.serial += 1`) must be read and written only as `Node.serial` (never `this.serial`).
- `@property` / `@x.setter` -> `get x()` / `set x(v)`. `__slots__` -> drop (but initialise all fields).
- `__repr__`/`__str__` -> `__repr__()`/`__str__()` methods (py.repr/py.str call them). `__eq__`, `__lt__`,
  `__bool__`, `__len__`, `__contains__` -> same-named methods; `py.eq`, `py.cmp`, `py.bool`, `py.len`,
  `py.contains` honour them. `__getstate__`/`__setstate__` -> same names (pickle.js calls them).
- **Mixins / multiple inheritance** (`class Game(ScreensUI, HudUI, MenuUI, LobbyUI, DefenseUI, ControlsUI)`,
  `class ScreensUI(SettingsUI, SavesUI)`): plain classes + `py.mixin` (C3 MRO, copies methods, getters, class
  attributes; the target's own members win):
  ```js
  export class ScreensUI { ... }
  py.classattrs(ScreensUI, { load_args: null, load_step: 0, stats_tab: 'score', ... });   // BEFORE mixin
  py.mixin(ScreensUI, SettingsUI, SavesUI);
  // ui.js:
  export class Game { constructor() { ... } ... }
  py.mixin(Game, ScreensUI, HudUI, MenuUI, LobbyUI, DefenseUI, ControlsUI);
  ```
  `super().draw_help()` inside a mixin -> `py.super_method(ScreensUI, this, 'draw_help')()`;
  `getattr(super(), 'overlay_click', None)` -> `py.super_method(ScreensUI, this, 'overlay_click')` (null if none).
  Mixins have no constructors in this codebase; keep it that way.
- `isinstance(x, Building)` -> `x instanceof Building`; `isinstance(x, str)` -> `typeof x === 'string'`;
  `(int, float)` -> `typeof x === 'number'` (Python bool is an int: add `|| typeof x === 'boolean'` if it matters);
  `(list, tuple)` -> `Array.isArray(x)`; `dict` -> `py.is_dict(x)`.

---

## 4. Values and idioms

| Python | JS | notes |
|---|---|---|
| `None` | `null` | test with `x == null` / `x != null` (loose: also catches `undefined`) |
| `True/False` | `true/false` | |
| `if lst:` / `not d` | `if (lst.length)` / `!py.bool(d)` | **empty list/dict are truthy in JS**. Use `.length`, `.size`, or `py.bool(x)` when the type varies |
| `a or b` (non-bool) | `py.or_(a, b)` or explicit | `x or []` on a list: `(x && x.length) ? x : []` |
| `a // b` | `py.floordiv(a, b)` or `Math.floor(a / b)` | ints and floats |
| `a % b` | `py.mod(a, b)` | sign of b (JS `%` differs for negatives). Plain `%` only when both are provably ≥ 0 |
| `divmod(a, b)` | `py.divmod(a, b)` | |
| `int(x)` | `Math.trunc(x)` (or `py.int(x)` for strings) | truncation, not floor |
| `round(x)` / `round(x, n)` | `py.round(x)` / `py.round(x, n)` | banker's rounding, CPython-exact |
| `abs`, `min(a, b)`, `max(a, b)` on numbers | `Math.abs/min/max` | |
| `min(seq, key=f)` / `max(...)` | `py.min(seq, f)` / `py.max(seq, f)` | returns the **first** extreme, like Python; `py.min(seq, null, dflt)` |
| `sum`, `any`, `all` | `py.sum`, `py.any`, `py.all` | |
| `sorted(xs, key=f, reverse=True)` | `py.sorted(xs, f, true)` | stable; tuple keys compare lexicographically |
| `xs.sort(key=f)` | `py.sort(xs, f)` | in place. **Never `.sort()` without a comparator.** For plain numeric keys `xs.sort((a, b) => ka - kb)` is equivalent (JS sort is stable, and reversed comparators keep ties in order like Python) |
| tuple `(a, b)` | array `[a, b]` | unpacking -> destructuring |
| `t1 == t2` (tuples/lists) | `py.eq(t1, t2)` | **`===` compares identity** |
| `t1 < t2` | `py.cmp(t1, t2) < 0` | |
| `x in (1, 2, 3)` (primitives) | `[1, 2, 3].includes(x)` | |
| `x in seq` (tuples, mixed) | `py.contains(seq, x)` | |
| `k in d` (dict) | `k in d` is wrong for `'constructor'` etc. -> `Object.hasOwn(d, k)` / `m.has(k)` / `py.contains(d, k)` | |
| `d.get(k, dflt)` | `py.get(d, k, dflt)` | `d[k] ?? dflt` only if the dict never stores None |
| `d.setdefault(k, v)`, `d.pop(k, dflt)` | `py.setdefault(d, k, v)`, `py.dpop(d, k, dflt)` | |
| `d.items()/keys()/values()` | `Object.entries/keys/values(d)` or `py.items(d)` | Map: `.entries()` |
| `d[k]` raising KeyError | `py.getitem(d, k)` | plain `d[k]` gives `undefined` |
| `len(x)` | `.length` / `.size` / `py.len(x)` | |
| `lst[-1]` | `lst[lst.length - 1]` or `py.at(lst, -1)` | |
| `lst[a:b]`, `s[::-1]` | `lst.slice(a, b)`, `py.slice(s, null, null, -1)` | `slice()` handles negatives like Python; steps need `py.slice` |
| `lst.pop(0)`, `lst.pop(i)`, `lst.insert(i, x)`, `lst.remove(x)`, `lst.index(x)` | `shift()`, `py.pop(lst, i)`, `py.insert`, `py.remove`, `py.index` | `remove/index` use `py.eq` |
| `lst.extend(xs)` | `py.extend(lst, xs)` | `push(...xs)` overflows the stack for huge arrays |
| `del lst[i]` / `del d[k]` | `lst.splice(i, 1)` / `delete d[k]` or `m.delete(k)` | |
| `[0] * n`, `[[0] * w for _ in range(h)]` | `new Array(n).fill(0)`, `Array.from({ length: h }, () => new Array(w).fill(0))` | |
| `bytearray(n)`, `bytes(...)` | `new Uint8Array(n)` | |
| `range(...)` in hot loops | plain `for (let i = a; i < b; i++)` | `py.range()` builds an array |
| `enumerate`, `zip`, `reversed` | `arr.entries()` / `py.enumerate`, `py.zip`, `py.reversed` | |
| `list(d)` | `Object.keys(d)` / `Array.from(m.keys())` / `py.list(x)` | |
| `copy.deepcopy`, `dict(d)`, `list(l)` | `py.deepcopy(x)`, `{ ...d }`, `l.slice()` | |
| `heapq.*`, `bisect.*`, `collections.Counter/defaultdict/deque` | `py.heappush/heappop/heapify`, `py.bisect_left/right`, `py.Counter`, `py.DefaultMap`, arrays | heapq is CPython's algorithm: same pop order on ties |
| `itemgetter(0, 1)` | `py.itemgetter(0, 1)` | |
| `id(obj)` | `py.id(obj)` | or use the object itself as a `Map` key |
| `getattr(o, 'x', d)` / `hasattr` / `setattr` | `py.getattr(o, 'x', d)` / `py.hasattr` / `o.x = v` | |
| `str(x)` | `String(x)` for ints/strings, `py.str(x)` for None/bools/lists, `py.float_str(x)` for Python floats | JS can't tell `3.0` from `3`: when Python prints a float, use `float_str` / a format spec |
| `f'{v:.1f}'`, `format(v, ',')` | `` `${py.fmt(v, '.1f')}` ``, `py.fmt(v, ',')` | full format-spec mini-language, CPython rounding |
| `'{} {n}'.format(a, n=1)` | `py.format('{} {n}', [a], { n: 1 })` | |
| `'%d/%s' % (a, b)` | `py.percent('%d/%s', [a, b])` | |
| `s.split()`, `s.split(',', 1)`, `strip/lstrip/rstrip(chars)`, `startswith(tuple)` | `py.split(s)`, `py.split(s, ',', 1)`, `py.strip(s, chars)`, `py.startswith(s, [..])` | JS `split` differs (no whitespace mode, limit semantics) |
| `s.isprintable()`, `isalnum`, `isdigit`, `capitalize`, `title`, `center/ljust/rjust/zfill` | `py.isprintable(s)` etc. | |
| `s.upper()/lower()`, `s.replace(a, b)` | `toUpperCase()/toLowerCase()`, `s.replaceAll(a, b)` | **`replace` replaces only the first match in JS** |
| `print(...)` | `console.log(...)` | |

**Dicts:**
- String keys (tables, JSON data, records): plain objects, same keys. Beware: JS objects iterate integer-like
  string keys (`'10'`, `'2'`) first in numeric order — if such keys occur and order matters, use a `Map`.
- **Int keys** (owner ids, tile indices): `Map` (keys stay numbers, insertion order kept).
- **Tuple keys** (`(tx, ty)`, `(kind, civ, color)`, colors): `py.TDict` (a Map compared by value; iterates
  `[key, value]`, `keys()` gives the original tuples), or a `Map` keyed by `py.tkey(tuple)` when you never need the
  keys back. Hot caches: `Map` + `py.tkey`. Grids: `ty * W + tx` when Python's own code does the same.
- Object keys (`dict[unit]`, `_MASKS[surf]`, `id(x)` keys): `Map` keyed by the object.
- Sets: `Set` for primitives/objects, `py.TSet` for tuples. `frozenset` -> `Set` (don't mutate).

**Numbers:** JS numbers are doubles — exact integers up to 2^53. Python ints are unbounded:
- Hash mixing / seeds that overflow 2^53 (e.g. `terrain._rng`: `(s * 1000003 + ...) & 0xffffffffffff`) -> **BigInt**
  (`py.random.Random` accepts BigInt seeds).
- **Bitwise operators are 32-bit in JS** (`|`, `&`, `^`, `<<`, `>>`). Use them only on values < 2^31; for wider
  masks use arithmetic or BigInt. `x | 0` truncates to int32 — don't use it as `int()`.
- `int.from_bytes(...)`/big-int bit tricks over bytearrays (world.py fog merge, ui.draw_fog) -> a plain loop over
  the `Uint8Array`s producing the same bytes.
- `math.sin/cos/exp/log` may differ from the C library by 1 ulp: floating results are "the same" but not
  bit-identical. Integer logic, sorting, random streams are exact.

**Exceptions:** `raise ValueError(...)` -> `throw new py.ValueError(...)` (also `KeyError`, `IndexError`,
`TypeError`, `RuntimeError`, `OSError`, `FileNotFoundError`, `ZeroDivisionError`; `pygame.error`).
`except X:` -> `catch (e) { if (!(e instanceof X)) throw e; ... }`. `except Exception:` -> `catch (e) { ... }`
(but log unexpected errors while developing). JS does not raise where Python does: `d[k]` missing, `lst[99]`,
`1 / 0`, `None.attr` → **TypeError** in JS too, but `undefined` values silently propagate. When Python code *relies*
on an exception (KeyError fallback, ZeroDivisionError), write the explicit check.

---

## 5. Main loop, screens, frames

The Python game has exactly one blocking loop, `Game.run` (ui.py). Screens (menu, lobby, loading, play, stats,
overlays) are already states dispatched per frame. The browser drives frames with `requestAnimationFrame`;
`pygame.run_loop(frame)` does it (and honours the `Clock.tick(fps)` cap):

```python
def run(self):
    while self.running:
        dt = min(self.clock.tick(int(gsettings.get('fps_limit', FPS) or FPS)) / 1000.0, 0.05)
        for e in pygame.event.get():
            self.on_event(e)
        ...draw / update...
        pygame.display.flip()
    pygame.quit()
```
```js
run() {
    return pygame.run_loop(() => {
        if (!this.running) { pygame.quit(); return false; }       // loop ends; the promise resolves
        const dt = Math.min(this.clock.tick(Math.trunc(gsettings.get('fps_limit', FPS) || FPS)) / 1000.0, 0.05);
        for (const e of pygame.event.get()) this.on_event(e);
        ...draw / update... (unchanged)
        pygame.display.flip();
        return true;
    });
}
```
Rules:
- **Nothing may block**: no `while` loop waiting for input/time, no `time.sleep` (it throws), no busy waits.
  A Python loop that waits across frames becomes state + a per-frame step (the codebase already does this:
  `loading_frame`, stats, overlays). Loops that finish within the frame (`finish_loading()` for tools, drawing
  loops) stay loops.
- An exception inside a frame stops the loop and prints the stack on the canvas (and the console).
- `main.js` (G9): `import './src/_all.js'; import { Game } from './src/ui.js'; await new Game().run();` then show a
  "closed — reload to play again" screen (the Exit button sets `running = False`).
- `pygame.display.flip()` is cheap (the canvas presents when the frame callback returns); keep it where Python has it.

---

## 6. Assets (read-only, shipped) — `runtime/assets.js`

Asset paths are **repo-root-relative POSIX strings**: `'assets/gen/atlas.json'`, `'assets/ui/skin/hud.png'`,
`'CREDITS.md'`. Replace the `__file__`-based constants with literals:

| Python | JS |
|---|---|
| `GEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'gen')` | `export const GEN = 'assets/gen';` |
| `ROOT = os.path.join(os.path.dirname(...), '..')` | `export const ROOT = '';` (then `os.path.join(ROOT, 'CREDITS.md')` = `'CREDITS.md'`) |
| `UI_DIR`, `FONT_DIR`, locale `DIR`, `AUDIO_DIR` | `'assets/ui'`, `'assets/fonts'`, `'assets/locale'`, `'assets/audio'` |
| `json.load(open(p, encoding='utf-8'))` (asset) | `assets.read_json(p)` (fresh object each call) |
| `open(p).read()` (asset text) | `assets.read_text(p)` |
| `os.path.exists(p)`, `os.listdir(d)` | `py.os.path.exists(p)`, `py.os.listdir(d)` (manifest + user storage) |
| `os.walk(base)` | `assets.walk(base)` -> `[[dirpath, dirnames, filenames], ...]` with repo-relative dirpath |
| `os.path.join/dirname/basename/splitext/relpath` | `py.os.path.*` (POSIX) |
| `pygame.image.load(p)` | `pygame.image.load(p)` — **synchronous, only for loaded assets** (else throws `pygame.error`) |
| `subprocess.run(['git', ...])` (menu.py) | `assets.git(args)` — answers recorded by the manifest tool (`''` if unknown) |
| `os.environ.get('X')` | `py.os.environ.X` — filled from the page URL query (`?KHRONIKI_LANG=ru&NO_SPRITES3D=1`) |

**What is loaded when** (boot.js, before `main.js` is imported):
- `boot` — every `.json/.md/.txt` (atlas, units/index.json + all unit meta JSON, maps.json, nature_extra, locale,
  audio manifest, cursors/hotspots, CREDITS.md), fonts, `assets/ui/{skin,icons,cursors}`, `assets/gen/{terrain,
  nature,decals,walls,maps}`.
- `buildings` (assets/gen/buildings, 24 MB) and `portraits` (assets/ui/portraits, 21 MB) — also awaited by boot.js.
- `sfx` (assets/audio/sfx) — prefetched in the background after boot; `assets.load_group('sfx')` returns the
  same promise (await it in sound.py's loader).
- `units` (assets/gen/units/*.png, 2.3 GB decoded) — **never preloaded**. Request sheets one by one:
  `assets.request([paths])` -> Promise; `assets.is_loaded(p)`; then `pygame.image.load(p)` works.
- `music` — streamed by `pygame.mixer.music` (never preloaded).

So: everything except unit sheets and sound files can be loaded synchronously anywhere, exactly like Python.
Top-level module code may read boot assets (modules are imported after boot).

Regenerate the manifest after changing assets: `node web/tools/build_manifest.mjs`.

## 7. Random and determinism

`py.random` is **bit-exact CPython MT19937**: same seeds (int, BigInt, str) give the same `random()`, `randint`,
`randrange`, `choice`, `choices`, `shuffle`, `sample`, `uniform`, `getrandbits`, `getstate/setstate` streams
(`gauss` equal up to 1 ulp). So `random.seed(n)` + mapgen must produce Python's exact map — test it.
- `import random` + `random.uniform(...)` -> `random.uniform(...)` (module-level instance).
- `random.Random(seed)` -> `random.Random(seed)` or `new random.Random(seed)` (both work).
- `random.choices(pop, weights=w, k=3)` -> `random.choices(pop, w, null, 3)` (kwargs rule).
- Keep **the exact order of random calls** (including calls inside sort keys, comprehensions, `and/or` short-circuits).
- `np.random.default_rng(seed)` is deterministic per seed but **not** numpy's PCG64 stream (visual noise in
  terrain textures / synth only). Don't use it where Python uses `random`.

`py.time.perf_counter()/monotonic()/time()/strftime(fmt)`; `pygame.time.get_ticks()` (ms since page load).

## 8. User files — `runtime/storage.js`

`~/.cache/khroniki` (`KHRONIKI_HOME`) -> the prefix `storage.HOME` (`'home'`). Synchronous like `open()`,
persisted to IndexedDB in the background (`await storage.flush()` if you must be sure).

| Python | JS |
|---|---|
| `HOME = os.environ.get('KHRONIKI_HOME') or os.path.join(os.path.expanduser('~'), '.cache', 'khroniki')` | `export const HOME = storage.HOME;` |
| `open(PATH).read()` / `json.load(f)` | `storage.read_text(PATH)` / `JSON.parse(storage.read_text(PATH))` (throws `FileNotFoundError`) |
| write via tmp + `os.replace` | `storage.write_text(PATH, JSON.stringify(obj, null, 1))` |
| `open(p, 'wb').write(b)` / `rb` | `storage.write_bytes(p, u8)` / `storage.read_bytes(p)` |
| `os.makedirs(d, exist_ok=True)` | nothing (`storage.makedirs()` is a no-op) |
| `os.listdir(SAVE_DIR)`, `os.remove`, `os.path.getmtime` | `storage.listdir`, `storage.remove`, `storage.getmtime` (or `py.os.listdir`) |
| `pygame.image.save(surf, path)` / `pygame.image.load(path)` (thumbnails) | same calls: PNG stored in storage, loadable synchronously right away and after reloads |

## 9. Threads, blocking I/O -> async

There are three threads in Python; none may block a frame in JS:
- `sound.Audio._load` (background load of effects): make it an `async` method started from the constructor
  (`this._load()` without await); it awaits `assets.load_group('sfx')`, creates the `Sound`s, then renders the
  missing procedural effects **one per macrotask** (`await new Promise(r => setTimeout(r, 0))` between effects),
  and sets `this.loaded = true` at the end — same observable behaviour as the thread.
- `sprites3d` unit-sheet preload (`_pre_worker` + `pump`): `request(kind, civ, female)` calls
  `assets.request([sheet, mask])`; when the promise resolves the sheet is available to `image.load`. `pump(budget)`
  may finish pending sheets (cheap) or do nothing; `preload_pending()` counts unresolved requests.
- `music.MusicPlayer` (procedural music generation; only used when there are no music files — the browser always
  has them): port it, but generate in small steps from a `setTimeout` chain / async function.
- `threading.Lock`, `queue.Queue`, `collections.deque` of jobs: plain fields/arrays.
- `time.sleep` -> not allowed; `subprocess`, `ctypes` -> removed with the documented fallbacks (git: `assets.git`;
  backing scale: `pygame.display.get_backing_scale()` = `devicePixelRatio`).

## 10. pygame runtime (`runtime/pygame.js`)

`import * as pygame from '../runtime/pygame.js'` — same names as pygame. Implemented (pygame-ce 2.5 semantics,
checked against real pygame in `web/tests/runtime.html`):

- **Constants**: `SRCALPHA`, `SCALED`, `RLEACCEL`, all `BLEND_*`, event types (`QUIT`, `KEYDOWN`, `KEYUP`,
  `MOUSEMOTION`, `MOUSEBUTTONDOWN/UP`, `MOUSEWHEEL`, `TEXTINPUT`, `USEREVENT`, window events), all `K_*` (SDL2
  keycodes, same numbers as pygame), `KMOD_*`, `SYSTEM_CURSOR_*`.
- **Rect** (`new pygame.Rect(x, y, w, h)` / `(pos, size)` / `(rect_like)`): all attributes incl. setters
  (`r.center = [x, y]`, `midbottom`, ...), floats truncated like pygame; `copy move move_ip inflate inflate_ip
  clamp clamp_ip clip union union_ip unionall fit normalize contains collidepoint colliderect collidelist
  collidelistall scale_by update`; iterable (`[...r]`, `r[0]`), `py.eq(r, [x,y,w,h])`, `py.bool(r)` (false if
  w or h is 0). **`if rect:` in Python -> `if (py.bool(rect))`.**
- **Surface** (`new pygame.Surface([w, h], flags=0)`): `blit(src, dest, area=null, special_flags=0)` (returns the
  clipped Rect), `blits`, `fill(color, rect=null, special_flags=0)`, `copy`, `convert` (drops alpha),
  `convert_alpha`, `subsurface(rect)` (**shares pixels with the parent**, writes go through), `get_rect(kw)`,
  `get_size/width/height`, `get_at/set_at`, `get_bounding_rect(min_alpha=1)`, `set_alpha/get_alpha` (applied at
  blit), `set_colorkey/get_colorkey`, `set_clip/get_clip`, `scroll`, `get_flags`, `get_bitsize` (always 32),
  `get_parent/get_offset/get_abs_offset`, `lock/unlock` (no-ops), `premul_alpha`.
  Semantics kept: `fill` and `draw.*` **replace** pixels (no blending; on opaque surfaces alpha is ignored);
  blits blend by source alpha; BLEND_* use pygame's integer formulas (`(a*b+255)>>8` for MULT).
  Surfaces are dict keys by identity (`Map`).
- **draw**: `rect(surface, color, rect, width=0, border_radius=0, tl=-1, tr=-1, bl=-1, br=-1)`, `line(s, c, start,
  end, width=1)`, `lines(s, c, closed, points, width=1)`, `aaline/aalines`, `polygon(s, c, points, width=0)`,
  `circle(s, c, center, radius, width=0, ...quadrants)`, `ellipse(s, c, rect, width=0)`, `arc(s, c, rect, start,
  stop, width=1)`; each returns a Rect. Canvas shapes are anti-aliased (pygame's are not): tiny edge differences.
- **transform**: `scale`, `smoothscale`, `scale_by`, `smoothscale_by`, `rotate` (pygame's size formula, nearest
  sampling, opaque corners filled like pygame), `rotozoom` (smoothed, SDL_gfx sizes), `flip`, `grayscale`
  (0.299/0.587/0.114), `average_color`.
- **font**: `new pygame.font.Font(path_or_null, size)` for the shipped TTFs (`'assets/fonts/PTSerif-Bold.ttf'`;
  `null` = FreeSansBold like pygame's default). `render(text, antialias, color, background=null)`, `size(text)`,
  `get_height/get_linesize/get_ascent/get_descent` (**exact SDL_ttf metrics**), `bold/italic/underline` attributes
  and setters. Widths come from the browser shaper: typically within 1–2 px of SDL_ttf (max 4 px on long strings)
  — layout code must not depend on exact pixel widths. `font.match_font()` returns `null` (no system fonts).
- **image**: `load(path)` (sync, preloaded assets or stored user PNGs), `save(surf, path)` (to storage),
  `frombuffer/frombytes/fromstring(bytes, size, 'RGBA'|'RGB'|'RGBX'|'ARGB'|'BGRA')`, `tobytes`.
- **surfarray** (numpy views, **(x, y[, c]) indexing** like pygame): `pixels3d`, `pixels_alpha` (writable views
  into the surface's pixel cache), `array3d`, `array_alpha` (copies), `make_surface(arr)`, `blit_array`. A view is
  an `np.NDArray` over the RGBA `Uint8ClampedArray` (`view.data`, `view.strides = [4, rowBytes(, 1)]`,
  `view.offset`): for speed write loops directly on `data` with those strides. The surface flushes the pixels to its
  canvas before the next canvas operation.
- **mask**: `pygame.mask.from_surface(surf, threshold=127)`, `Mask` with `get_size get_at set_at count fill clear
  invert copy overlap overlap_area overlap_mask draw erase centroid get_bounding_rects to_surface(surface, setsurface,
  unsetsurface, setcolor, unsetcolor, dest)`.
- **Vector2** (`pygame.Vector2` / `pygame.math.Vector2`): no operator overloading —
  `(Vector2(pos) - r.center).length()` -> `new pygame.Vector2(pos).sub(r.center).length()`; `add sub mul(k|v)
  div dot cross length length_squared normalize rotate(deg) distance_to angle_to lerp`, `.x/.y`, iterable.
- **Color**: `pygame.Color(...)` returns a plain `[r, g, b, a]` array. Colors everywhere are arrays.
- **event**: `pygame.event.get()` drains the queue; events are `pygame.event.Event` objects with pygame's
  attributes: KEYDOWN/KEYUP `key mod unicode scancode`; MOUSEBUTTONDOWN/UP `pos button` (1 left, 2 middle,
  3 right; **wheel steps also arrive as buttons 4/5**, like pygame 2); MOUSEMOTION `pos rel buttons`; MOUSEWHEEL
  `x y precise_x precise_y flipped`. `new pygame.event.Event(type, {key, mod, unicode})` (dict = **kwargs).
  `e.dict`. `getattr(e, 'mod', 0)` -> `py.getattr(e, 'mod', 0)`. Key repeat is off (as in pygame without set_repeat).
  Letters/digits map by physical key (like SDL on non-Latin layouts); `unicode` is the typed character.
- **key**: `get_pressed()[pygame.K_LEFT]`, `get_mods()`, `name(k)` (pygame compat names: `'a'`, `'f10'`, `'space'`,
  `'[+]'`, `'page up'`), `key_code(name)`, `set_repeat`.
- **mouse**: `get_pos()` (logical 1280x800 coords), `get_pressed()`, `get_rel()`, `get_focused()` (pointer inside
  the canvas and window focused), `set_visible`, `set_cursor(SYSTEM_CURSOR_* | pygame.cursors.Cursor)`.
  `new pygame.cursors.Cursor([hx, hy], surface)` becomes a CSS cursor.
- **display**: `set_mode(size, flags)` returns the screen surface drawn directly into the page canvas (CSS-scaled
  with letterboxing, like SCALED); `get_surface`, `flip/update`, `set_caption` (document title),
  `toggle_fullscreen/is_fullscreen` (the browser needs a recent user gesture: from a key/click handler it works;
  at startup it is refused silently), `get_backing_scale()` (= `devicePixelRatio`, for uiskin.backing_scale).
- **time**: `get_ticks()`, `new pygame.time.Clock()` (`tick(fps)` returns ms and sets the frame cap for
  `run_loop`, `get_fps()`), `set_timer(event, ms, loops)`. `delay/wait` return immediately.
- **mixer** (Web Audio): `init/pre_init/get_init` (`[sampleRate, -16, 2]` — the sample rate is the browser's,
  often 48000), `set_num_channels`, `set_reserved`, `find_channel(force)`, `stop`, `pause/unpause`, `fadeout`,
  `get_busy`; `pygame.mixer.Channel(i)` (same object each time) with `play(sound, loops, maxtime, fade_ms)`,
  `stop`, `fadeout`, `set_volume(v)` / `set_volume(left, right)`, `get_busy`, `get_sound`, `queue`,
  `set_endevent`; `new pygame.mixer.Sound(file)` where `file` is an asset path (**must be loaded**:
  `sfx` group or `assets.request`), WAV bytes (`Uint8Array` — `Sound(file=io.BytesIO(wav))` keeps working), or
  `{array: np.NDArray (n, 2) int16|float}`; `play(loops, maxtime, fade_ms)` (resets the channel volume like
  pygame), `stop`, `set_volume/get_volume`, `get_length`, `get_num_channels`.
  `pygame.mixer.music`: `load(path)` (asset path, streamed from `assets/audio/music`), `play(loops, start,
  fade_ms)`, `stop`, `pause/unpause`, `fadeout`, `set_volume/get_volume`, `get_busy` (true also while the browser
  waits for the first user gesture to allow audio), `get_pos`, `queue`, `set_endevent`.
  Audio unlocks on the first click/key automatically.
- **misc**: `pygame.init/quit/get_init`, `pygame.error`, `pygame.version.ver`, `pygame.run_loop(frame)`,
  `pygame.set_error_handler(fn)`, `pygame._inject(event)` (tests).

Performance notes (browser): `blit` of sprites/text and `draw.*` are fast (~2 µs per blit). Pixel operations
(`get_at` on big surfaces, BLEND_* on SRCALPHA/translucent sources, `grayscale`, `surfarray`, masks,
`get_bounding_rect`) read pixels back from the canvas — fine for one-time sprite preparation and for small surfaces
every few frames (minimap, fog: as in Python), not for full-screen work every frame. Pixel loops over `set_at` are
fast (they write into a cached `ImageData`). Font `render` creates a canvas each call: cache text surfaces where
Python caches them (it already does in hot paths).

Missing something? **Don't edit `web/runtime/*` or other groups' files** (parallel porters). Add a small local helper
in your module named `_rt_<what>` and list it in your final report; the foundation owner merges it.

## 11. numpy -> `runtime/np.js`

Functional API (no operators): `np.add/subtract/multiply/divide/power/maximum/minimum/mod/floor_divide`
(aliases `mul/sub/div`), comparisons `greater/less/...` (-> bool arrays), `where, clip, abs, sin, cos, exp, log,
log2, sqrt, sign, floor, ceil, rint/round, nan_to_num, isin, choose`, reductions `sum/mean/max/min/any/all(a,
axis)`, `cumsum`, `np.maximum.accumulate(a, axis)`, `argmax`, `nonzero`, constructors `array zeros ones full
empty zeros_like ones_like arange linspace frombuffer`, shape ops `reshape ravel flatten transpose/.T concatenate
stack tile repeat broadcast_to ascontiguousarray`, `interp`, `linalg.norm`, `fft.rfft/irfft/rfftfreq` (any length;
returns `np.Complex {re, im}` with `.mul(realArray)`), `np.random.default_rng(seed)` (`random, uniform,
standard_normal, normal, integers, choice, shuffle`), `np.errstate()` (no-op), dtypes `'float64' 'float32'
'int32' 'int64' 'uint8'...`.
Arrays: `NDArray` with `shape`, `strides`, `offset`, `data` (typed array); `a.get(i, j)`, `a.set(v, i, j)`,
**slicing views** `a.s([start, stop, step], null, 3, '+')` (null = `:`, integer drops the axis, `'+'` = `None`/newaxis),
`view.assign(src)` for `a[...] = src` / `a[2:5] = x` (broadcasting), `copy astype tolist item`.
`x[end - nr:] *= ramp` -> `x.s([end - nr, null]).assign(np.multiply(x.s([end - nr, null]), ramp))`.
Numeric results equal numpy's up to float rounding (float64 by default; float32 inputs stay float32).
Performance: np.js loops are generic; in hot per-pixel code (terrain_gfx, sprites3d recolor) plain `for` loops
over typed arrays are welcome — **same arithmetic, same order**.

## 12. Saves — `runtime/pickle.js`

`pickle.dumps(obj, {persistent_id})` -> JSON text; `pickle.loads(text, {persistent_load})`. Keeps shared
references and cycles, class instances (**every class that can be reached from the World must be registered**:
`py.register_class(Cls, 'module.Cls')` right after the class — G2 world classes, G3 naval `Ship`, `Relic`, AI
classes `AI/ArmyPlanner/WarPlanner/NavalAI`, anything stored on the world), `Map/Set/TDict/TSet/Counter`, typed arrays
(bytearray -> Uint8Array), NaN/inf, BigInt. `__getstate__/__setstate__` are honoured. Functions without a
persistent id are saved as `null` (like `persistent_id -> ('N',)` for lambdas). `savegame.py`'s registry of static
tables by `id()` maps to a `Map` keyed by the table objects themselves; module objects (`types.ModuleType`) are ES
module namespaces (`Object.prototype.toString.call(x) === '[object Module]'`); pygame objects (Surface, Font,
Sound: `x instanceof pygame.Surface` ...) -> not saved (`null`).
Save format: the Python writes two pickles (header, body) into `<slot>.sav`; in JS write
`JSON.stringify(header) + '\n' + pickle.dumps(body)` with `storage.write_text` (header readable without parsing the
body), thumbnail via `pygame.image.save`. `random.getstate()` is JSON-safe.

## 13. Testing your module

- Node (logic modules: data, world, sim, ai, mapgen...):
  ```js
  import test from 'node:test'; import assert from 'node:assert/strict';
  import { setup } from './node_env.mjs';      // manifest + all json/md/txt assets + font metrics, memory storage
  await setup();
  await import('../src/_data_init.js');         // data + content + relabel, like `import game.data`
  const world = await import('../src/world.js');
  ```
  Name tests `web/tests/test_<module>.mjs`. Deps not ported yet: run with `--import ./web/tests/stub_loader.mjs`.
  Compare against Python: write `web/tests/gen_<module>_ref.py` that seeds `random`, runs the Python code and
  dumps JSON into `web/tests/fixtures/`; assert equality in JS.
- Browser (drawing, UI, audio): a page `web/tests/<group>.html` + script that sets `window.__results`; run
  `node web/tests/browser_check.mjs web/tests/<group>.html`. Compare screenshots with the Python game's
  (`tools/shot.py` etc. make them) by eye.
- Every module must at least load (syntax, imports, top-level code):
  `node --import ./web/tests/stub_loader.mjs --input-type=module -e "await import('./web/src/<m>.js')"`
  (modules using `pygame.Surface` at top level need the browser; `OffscreenCanvas`/`ImageData` don't exist in node).

## 14. Stub policy (parallel work)

If you need a symbol from a module owned by another group, **import it by its Python name from its module path**
(`import { shade } from './data.js'`, `modules.gfx.draw_unit(...)`) and trust it exists with the Python signature
(kwargs rule). Don't create, edit or stub other groups' files in `web/src/`. For your own tests use
`stub_loader.mjs`. If the other module's Python has something that cannot be ported 1:1 and you depend on its
changed shape, say so in your report.

## 15. Module -> group

| Group | Modules (game/*.py -> web/src/*.js) |
|---|---|
| G1 data | data, content/* (all, `__init__` -> `content/__init__.js`), i18n, settings, keymap, themes, maps, scoring |
| G2 world | world |
| G3 sim | naval, relics, market, defense, orders, match, stats, savegame |
| G4 ai | ai, ai_army, ai_war, ai_defense, eco_ai, naval_ai |
| G5 map | mapgen, terrain, map_assets |
| G6 gfx | gfx, sprites3d, sprites_extra, civ_art, terrain_gfx, naval_gfx, wallgfx, map_icons, menu_art |
| G7 ui core | ui, widgets, uiskin, uiskin_map, controls, controls_draw |
| G8 hud | hud, hud_windows, defense_ui, economy_ui, civ_ui |
| G9 screens | menu, screens, lobby, settings_ui, saves_ui, playlist, main.py -> web/main.js |
| G10 audio | sound, synth, music |

Foundation-owned (don't edit): `web/runtime/*`, `web/boot.js`, `web/index.html`, `web/demo.*`,
`web/src/_data_init.js`, `web/src/_all.js`, `web/tools/*`, `web/tests/{node_env,stub_loader,stub_hooks,
browser_check}.mjs`, runtime tests and fixtures.

## 16. Per-group notes (known traps)

**G1 data**
- `data.py` ends with `__import__('.content')` + `i18n.relabel()`: **drop both** from data.js (an ES module cannot
  import content without a cycle) — `web/src/_data_init.js` does it in the same order.
- `content/__init__.py` discovers modules with `pkgutil` -> `content/__init__.js` defines `add_unit/add_building/
  add_tech/add_trains/add_techs` as **`function` declarations** (hoisted: content modules call them while
  `__init__.js` is still loading), then imports, **in Python's sorted order, skipping `_` names**:
  `army_archers, army_base, army_blacksmith, army_cavalry, army_infantry, army_monks, army_siege,
  army_university, civ_units, civs, economy, garrison, man_at_arms, naval, relics_wolves, towers, walls,
  zz_university_stub`. (ES imports evaluate in statement order — that is the registration order.)
- Content art functions import gfx/naval_gfx/economy_ui/world/defense inside functions -> `modules.gfx` etc.
  Top-level imports (`_army_art`, `civ_art`, `market`, `relics`, `data`) stay static.
- `shade()` caches by `(c, d)` with a TypeError fallback for unhashable colors -> `Map` keyed by
  `py.tkey([...c, d])`; returns the cached array (don't mutate returned colors).
- `i18n`: locale files via `assets.read_json('assets/locale/' + code + '.json')`; first-run language:
  `KHRONIKI_LANG` from `py.os.environ`, then `navigator.languages` instead of `locale.getlocale()/LANG`.
  `t(key, **fmt)` -> `t(key, fmt = {})`; `s.format(**fmt)` -> `py.format(s, [], fmt)` inside the same try/catch
  (KeyError/IndexError/ValueError -> keep `s`). `relabel()` mutates data lists in place (`splice`).
- `settings`: `PATH = os.path.join(storage.HOME, 'settings.json')`, read/write via storage (keep the
  merge-with-defaults logic). `keymap` works on pygame key names (runtime implements pygame's compat names).
- `maps.py` imports i18n at the bottom — keep as a static import (no top-level use in a cycle).

**G2 world**
- `bytearray` -> `Uint8Array` (`vis`, `explored`, `ground`...). The `int.from_bytes(...) | ...` merge (≈ line 2581)
  -> a loop with the same result. `frozenset` -> `Set`.
- `emit(self, *ev)` -> `emit(...ev)` (stores the array). `heapq` -> `py.heappush/heappop` (exact tie order matters
  for pathfinding). `sorted(range(n), key=lambda pid: (team, random.random()))` -> `py.sorted` (calls the key once
  per element, in order — same random stream).
- `__getstate__/__setstate__` keep their names; `py.register_class` for `Player, Node, Building, Unit, Animal,
  Projectile, World` (qualnames `'world.Unit'` ...).
- Hot paths: avoid `py.range`, tuple allocations in inner loops only where the result is identical; `math.hypot`
  from py.js is `sqrt(x*x+y*y)` for two args (fast).

**G3 sim**
- `savegame` -> `pickle.js` (§12); `SAVE_DIR = os.path.join(storage.HOME, 'saves')`; `meta_of` date via
  `time.strftime('%Y-%m-%d %H:%M')`; list slots with `storage.listdir` (catch FileNotFoundError -> empty).
- `naval.FISH` is computed at import from NODE_DEFS: correct as long as `_data_init.js` loads first (it does).
- `Ship(Unit)` -> `class Ship extends Unit`, `super(...)` first. Register `Ship`, `Relic` for saves.

**G4 ai**
- Pure logic. Watch `min/max(key=)` ties (first wins: `py.min/py.max`), dict iteration order (Map for int keys),
  `sorted` stability, `random` call order, `%` with negatives (`py.mod`). Register AI classes for saves.

**G5 map**
- `terrain._rng`: 48-bit mixing (`s * 1000003` overflows 2^53) -> BigInt arithmetic, `random.Random(bigint)`.
- mapgen reproducibility (`random.seed(n)` then `World(...)`) must match Python exactly: generate a fixture with
  the Python generator and compare terrain/ground/elevation arrays in a node test.
- `map_assets`: `maps.json` via `assets.read_json`, images via `pygame.image.load` (boot group).

**G6 gfx**
- `sprites3d._load(rel)` -> `pygame.image.load(GEN + '/' + rel)`: buildings/nature/terrain/walls are preloaded.
  **Unit sheets are not**: `USet._ensure()` must, if `!assets.is_loaded(file)`, call `assets.request([file, mask])`
  and let `frame()` return a transparent placeholder `(1x1 surface, ax, ay)` **without caching it**, so the unit
  appears as soon as its sheet arrives (Python would stall ~60 ms instead). Meta JSON (`rec['meta']`) and
  `units/index.json` are preloaded (sync). Add `sheet_paths(kind, civ, female=false)` -> `[file, mask]` asset
  paths (used by G9 to preload before a match / the menu). `request/pump/preload_pending` over promises (§9).
  `_mask_rgb`: `get_bitsize()` is always 32 — the check reduces to the SRCALPHA flag.
- `menu_art` caches tiles that draw unit sheets (knight/franks, archer/britons, ...): export
  `menu_art.preload()` -> Promise that requests the sheets it uses (G9 awaits it before the menu); don't cache a
  tile that was drawn with a placeholder.
- `terrain_gfx`: numpy + surfarray -> np.js views or typed-array loops (same formulas). `np.random.default_rng`
  noise won't match numpy bit-for-bit (visual only). `warp_fog` uses `pixels_alpha` (x, y) indexing.
- `gfx`, `civ_art`, `naval_gfx`, `wallgfx`: heavy `pygame.draw` + `random.Random(seed)` (exact). BLEND_RGBA_MIN
  etc. go through the pixel path (fine for sprite preparation).
- `map_icons`: `random.getstate()/seed()/setstate()` on the module-level random — supported.

**G7 ui core**
- `Game(ScreensUI, HudUI, MenuUI, LobbyUI, DefenseUI, ControlsUI)` -> `py.mixin(Game, ...)` after the class; the
  main loop per §5 (`run()` returns the run_loop promise).
- `_USPR`/`_render_unit` cache keyed by tuples -> `Map` + `py.tkey`; `_MASKS` keyed by surface -> `Map`.
- `draw_fog`: `bytes.translate` + big-int OR -> a loop filling the alpha bytes; then `frombuffer` / smoothscale /
  `rotate(-45)` / BLEND_RGBA_SUB — all supported (runs only when fog changes).
- Click hit-tests use `surf.get_at(...)[3]` on sprite frames — supported (reads one pixel).
- `on_wheel`: `getattr(e, 'precise_y', e.y)` and `flipped` exist on MOUSEWHEEL events.
- `uiskin`: `FONT_DIR = 'assets/fonts'`, `match_font` returns null (shipped fonts exist, the branch isn't taken),
  `cjk_file()` -> null (no CJK fonts shipped); `_portrait_index` via `assets.walk('assets/ui/portraits')`;
  `backing_scale()` -> `pygame.display.get_backing_scale()` (delete the ctypes/objc code);
  `Cursors`: system cursors via `new pygame.cursors.Cursor([hx, hy], surf)` + `pygame.mouse.set_cursor`, the soft
  cursor draws on the screen like Python.

**G8 hud**
- `draw_minimap`: `copy()`, BLEND_RGB_MULT fill, `set_at` loops, `frombuffer`, `rotate(-45)`, `smoothscale` — all
  supported; keep the every-10-frames refresh. Vector2 math -> method calls. Chat input: KEYDOWN `e.unicode` +
  `py.isprintable`.

**G9 screens**
- `menu._git(*args)` -> `assets.git(args)`; CREDITS via `assets.read_text(os.path.join(ROOT, 'CREDITS.md'))`.
- `screens.loading_frame`: before switching to `'play'`, also wait (without blocking — just don't advance the step)
  until the unit sheets of the starting units of every player are loaded (`sprites3d.sheet_paths(...)` +
  `assets.request`), showing the same loading screen.
- `apply_startup_settings`: `toggle_fullscreen()` at startup is refused by browsers (no gesture) — keep the
  try/except; the settings toggle works from a click.
- `saves_ui`: thumbnails via `pygame.image.load(path)` (storage PNGs work synchronously).
- `playlist`: `os.path.exists(os.path.join(base_dir, p))` works via the manifest; `mm.load(path)` streams.
  `random.Random()` (unseeded) is fine.
- `web/main.js` (port of main.py): `import './src/_all.js'`, `await modules.menu_art.preload()` (G6), then
  `new Game().run()`; after the promise resolves draw a "closed" screen.

**G10 audio**
- `sound.Audio`: `pygame.mixer.get_init()/init()`, `S.set_rate(freq)` with the browser rate; `_load` -> async (§9);
  `SETTINGS = os.path.join(storage.HOME, 'settings.json')` read/merge/write via storage; `wav_bytes()` needs a
  small WAV writer (RIFF + `S.to_pcm`) -> `Uint8Array`, and `new pygame.mixer.Sound(bytes)` parses it synchronously.
  `pygame.font.Font(pygame.font.match_font('arial') or None, 14)` -> `new pygame.font.Font(null, 14)`.
- `synth`/`music`: numpy -> np.js; `np.random.default_rng` differs from numpy (procedural sound only).
  `music.MusicPlayer` threads -> async steps; it is only used when there are no music files.
- Ogg/Opus: Chrome/Firefox/Edge decode it; old Safari (< 17) may not — then sounds fall back to procedural ones
  via the existing FALLBACK chains (keep that logic intact).

## 17. Integration notes (after all groups were merged)

- **Exact floats.** `py.math.hypot` / `py.math.dist` implement CPython's `vector_norm` (bit-identical to Python's
  `math.hypot`; a plain `sqrt(x*x + y*y)` differs in ~25% of calls). `py.sum` uses CPython 3.12+'s compensated
  (Neumaier) float summation — **port every `sum(...)` of floats with `py.sum`**, never with a `+=` loop (group
  centroids in orders/ai/ai_army/naval were loops and drifted by one ulp). Transcendentals (`sin`, `cos`, `atan2`,
  `exp`...) differ from the C library by one ulp now and then and cannot be matched.
- **Lockstep test.** `web/tests/test_lockstep.mjs` runs whole AI-vs-AI matches (World + AI, 17-24 game minutes, 2-4
  players, land and water maps) and compares a full-precision state digest with CPython every 150 steps
  (`gen_lockstep_ref.py` makes the fixture). Both sides round transcendental results to float32 for the test; every
  other operation must be exact. A failure prints the first step that differs: bisect from there.
- **Control groups** (`Game.groups`) are always a `Map` (saves_ui converts older plain objects).
- **Page handles for tools:** `web/main.js` sets `window.__game` (the Game), `window.__pygame`, `window.__py`;
  `pygame.loop_stats` (`mean_ms`, `max_ms`, `frames`, `reset()`) measures the time spent inside frames.
- **End-to-end:** `node web/tests/e2e.mjs` plays the menu → skirmish → build/train → 3 game minutes → tech tree →
  save/load → language switch → quit flow in headless Chromium and fails on any console error.
- **Hosting:** the repository root is the site root; `/.nojekyll` is required on GitHub Pages (Jekyll would drop
  `_all.js`, `_data_init.js`, `content/_army_art.js`, `content/_uni.js`), `/index.html` redirects to `web/`.
