"""Relief as in AoE II DE: heights 0-7, cliffs, shallows, ground types (no pygame - this is part of the world).

The world.terrain cell codes:  0 - land, 1 - water, 2 - shallows (foot units walk, ships do not sail, building
is not allowed), 3 - a cliff (impassable). Passability for foot units - an even code (t & 1 == 0).

Height is stored at the cell vertices: world.hz[(H+1)][(W+1)] - screen pixels (level x ZL); across a cell -
bilinearly, the way the ground draws it (game/terrain_gfx.py). The integer level of a cell (0..7, for the combat and
building rules) - world.elev[ty*W + tx] = the rounded mean of the four corners.

A single way of "world point -> screen with height" for all drawing code:
  terrain.ZL                    - screen pixels per level (16 = HH: 24 px in the classic at a 96 px tile, ours 64)
  World.z_at(x, y)              - the ground height under a world point (logical px) in screen pixels
  World.elev(tx, ty)            - the integer level of a cell
  data.to_iso(x, y, ox, z)      - world -> the isometric map, raised by z pixels
  Game.w2s(x, y, z=None)        - world -> screen; z by default - the ground height at the point
  Game.s2w(sx, sy)              - screen -> world taking relief into account (the ground point under the cursor)
"""
import math
import random

from .data import TILE, HH

ZL = HH                 # screen pixels per height level
MAX_LEVEL = 7
SLOPE = 0.7             # the limit of the difference between neighboring vertices (levels per tile): slopes do not "fold"
BUILD_SLOPE = 0.5       # a building: the height difference of the base corners <= 1/2 level (the sprite stands at the average height: the corners
                        # diverge from the slope by <= ~8 px; at 1.0 it was up to 14.7 px - 09 #27)
HEIGHT_BONUS = 0.25     # +-25 % damage from top to bottom / from bottom to top (AoE II DE)

LAND, WATER, SHALLOW, CLIFF = 0, 1, 2, 3

# ground types (world.ground) - for textures and blending; the blending order is PRIORITY (higher - on top)
GROUNDS = ('grass', 'grass2', 'grass3', 'dirt', 'dirt2', 'dirt3', 'forest', 'pine', 'sand', 'beach',
           'shallow', 'water', 'rocky')
G = {n: i for i, n in enumerate(GROUNDS)}
PRIORITY = ('water', 'shallow', 'beach', 'sand', 'grass', 'grass2', 'grass3', 'dirt3', 'dirt2', 'dirt', 'rocky',
            'pine', 'forest')
# the minimap color by type (as in AoE2: grass green, earth ochre, forest dark green, sand light)
MM_COLOR = {'grass': (98, 150, 62), 'grass2': (90, 140, 56), 'grass3': (112, 152, 64), 'dirt': (178, 142, 76),
            'dirt2': (190, 160, 96), 'dirt3': (140, 140, 70), 'forest': (40, 92, 36), 'pine': (36, 84, 40),
            'sand': (196, 180, 120), 'beach': (206, 190, 132), 'shallow': (96, 170, 180), 'water': (40, 90, 160),
            'rocky': (130, 118, 96)}

_SPECIES_W = (('oak', 5), ('beech', 3), ('deci', 3), ('birch', 2), ('pine', 3), ('fir', 3), ('poplar', 1))
CONIFERS = ('pine', 'fir')


def _hash(x, y, s=0):
    h = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    return (h ^ (h >> 13)) & 0x7fffffff


def tree_species(tx, ty, names=None):
    """The tree species on a tile: 7x7 patches of one species with an admixture. names - the available species (by default all)."""
    names = [(n, w) for n, w in _SPECIES_W if names is None or n in names]
    if not names:
        return None
    rx, ry = tx // 7, ty // 7
    if _hash(tx, ty, 5) % 4 == 0:           # the patch borders are slightly uneven
        rx, ry = (tx + 3) // 7, (ty + 3) // 7
    tot = sum(w for _, w in names)
    r = _hash(rx, ry, 1) % tot
    sp = names[-1][0]
    for n, w in names:
        if r < w:
            sp = n
            break
        r -= w
    if _hash(tx, ty, 9) % 5 == 0:          # an admixture of another species
        sp = names[_hash(tx, ty, 11) % len(names)][0]
    return sp


# ============================================================ world state
def ensure(w):
    """Flat relief by default (old saves, test worlds before generation)."""
    W, H = w.W, w.H
    if getattr(w, 'hz', None) is None or len(w.hz) != H + 1:
        w.hz = [[0.0] * (W + 1) for _ in range(H + 1)]
    if getattr(w, 'elev_map', None) is None or len(w.elev_map) != W * H:
        w.elev_map = bytearray(W * H)
    if getattr(w, 'ground', None) is None or len(w.ground) != W * H:
        w.ground = bytearray(W * H)
    if getattr(w, 'cliffs', None) is None:
        w.cliffs = []
    if not hasattr(w, 'relief'):
        w.relief = False
    if not getattr(w, 'theme', None):
        w.theme = 'grass'           # landscape (game/themes.py); old saves - the former look


def z_at(w, x, y):
    """The ground height (screen px) under a world point (x, y in logical px) - bilinear across the vertices."""
    if not w.relief:
        return 0.0
    fx = x / TILE
    fy = y / TILE
    ix = int(fx)
    iy = int(fy)
    W, H = w.W, w.H
    if ix < 0:
        ix, fx = 0, 0.0
    elif ix >= W:
        ix, fx = W - 1, float(W)
    if iy < 0:
        iy, fy = 0, 0.0
    elif iy >= H:
        iy, fy = H - 1, float(H)
    ax = fx - ix
    ay = fy - iy
    r0 = w.hz[iy]
    r1 = w.hz[iy + 1]
    a = r0[ix] + (r0[ix + 1] - r0[ix]) * ax
    b = r1[ix] + (r1[ix + 1] - r1[ix]) * ax
    return a + (b - a) * ay


def elev(w, tx, ty):
    if 0 <= tx < w.W and 0 <= ty < w.H:
        return w.elev_map[ty * w.W + tx]
    return 0


def elev_px(w, x, y):
    return elev(w, int(x // TILE), int(y // TILE))


def footprint_range(w, tx, ty, sw, sh):
    """(min, max) of the heights of the corners of the base cells (levels)."""
    lo, hi = 1e9, -1e9
    for y in range(max(0, ty), min(w.H, ty + sh) + 1):
        row = w.hz[y]
        for x in range(max(0, tx), min(w.W, tx + sw) + 1):
            v = row[x]
            if v < lo:
                lo = v
            if v > hi:
                hi = v
    if lo > hi:
        return 0.0, 0.0
    return lo / ZL, hi / ZL


def slope_ok(w, tx, ty, sw, sh=None):
    """Whether a building can be placed: the height difference across the base <= BUILD_SLOPE levels."""
    if not w.relief:
        return True
    lo, hi = footprint_range(w, tx, ty, sw, sw if sh is None else sh)
    return hi - lo <= BUILD_SLOPE + 1e-6


def height_mult(w, att, target):
    """The damage multiplier for height: x1.25 from top to bottom, x0.75 from bottom to top (the difference of the cells' integer levels)."""
    if not w.relief:
        return 1.0
    ax, ay = att.center()
    bx, by = target.center()
    ea = elev_px(w, ax, ay)
    eb = elev_px(w, bx, by)
    if ea > eb:
        return 1.0 + HEIGHT_BONUS
    if ea < eb:
        return 1.0 - HEIGHT_BONUS
    return 1.0


def footprint_z(w, tx, ty, sw, sh):
    """The average height of the base corners (px) - the building stands at it (cached: the relief does not change)."""
    if not w.relief:
        return 0.0
    cache = w.__dict__.get('_bz')
    if cache is None:
        cache = w._bz = {}
    k = (tx, ty, sw, sh)
    z = cache.get(k)
    if z is None:
        tot = n = 0
        for y in range(max(0, ty), min(w.H, ty + sh) + 1):
            row = w.hz[y]
            for x in range(max(0, tx), min(w.W, tx + sw) + 1):
                tot += row[x]
                n += 1
        z = cache[k] = tot / n if n else 0.0
    return z


def building_z(w, b):
    return footprint_z(w, b.tx, b.ty, b.w, b.h)


def ground_at(w, ix, iy, ox):
    """A screen without the camera offset (ix, iy - isometry raised by the relief) -> a world ground point (x, y).
    We look for the point of the column whose iy_flat - z = iy: the iteration iy_flat = iy + z (slopes < 1 -> it converges)."""
    ix -= ox
    if not w.relief:
        return (ix + 2 * iy) * 0.5, (2 * iy - ix) * 0.5
    fy = iy
    z = 0.0
    for _ in range(12):
        x = (ix + 2 * fy) * 0.5
        y = (2 * fy - ix) * 0.5
        z2 = z_at(w, x, y)
        if abs(z2 - z) < 0.05:
            break
        z = z * 0.3 + z2 * 0.7 if _ > 5 else z2
        fy = iy + z
    return (ix + 2 * fy) * 0.5, (2 * fy - ix) * 0.5


# ============================================================ generation
def _rng(w, starts, salt):
    s = w.W * 7919 + salt * 104729 + len(starts) * 31 + sum(len(x) for x in (w.map_type,))
    for i, (x, y) in enumerate(starts):
        s = (s * 1000003 + x * 131 + y * 17 + i) & 0xffffffffffff
    return random.Random(s)


def _noise(W, H, cell, rng):
    """Smooth value noise (H rows x W columns, 0..1)."""
    gw, gh = W // cell + 3, H // cell + 3
    g = [[rng.random() for _ in range(gw)] for _ in range(gh)]
    out = []
    for y in range(H):
        fy = y / cell
        y0 = int(fy)
        ty = fy - y0
        ty = ty * ty * (3 - 2 * ty)
        ga, gb = g[y0], g[y0 + 1]
        row = []
        for x in range(W):
            fx = x / cell
            x0 = int(fx)
            tx = fx - x0
            tx = tx * tx * (3 - 2 * tx)
            a = ga[x0] + (ga[x0 + 1] - ga[x0]) * tx
            b = gb[x0] + (gb[x0 + 1] - gb[x0]) * tx
            row.append(a + (b - a) * ty)
        out.append(row)
    return out


def _labels(W, H, ok):
    """Connected components (by sides) of cells where ok[i] is true: a list of labels (-1 - the wrong cell), the count."""
    lab = [-1] * (W * H)
    n = 0
    for s in range(W * H):
        if lab[s] >= 0 or not ok[s]:
            continue
        lab[s] = n
        st = [s]
        while st:
            c = st.pop()
            x = c % W
            if x + 1 < W and lab[c + 1] < 0 and ok[c + 1]:
                lab[c + 1] = n
                st.append(c + 1)
            if x > 0 and lab[c - 1] < 0 and ok[c - 1]:
                lab[c - 1] = n
                st.append(c - 1)
            if c + W < W * H and lab[c + W] < 0 and ok[c + W]:
                lab[c + W] = n
                st.append(c + W)
            if c >= W and lab[c - W] < 0 and ok[c - W]:
                lab[c - W] = n
                st.append(c - W)
        n += 1
    return lab, n


def gen_shallows(w, starts):
    """Shallows: part of the rim of lakes and shores (foot units cross, ships do not). Straits are not blocked,
    islands are not joined, the connectivity of the water is not broken."""
    rng = _rng(w, starts, 1)
    W, H = w.W, w.H
    T = w.terrain
    flat = [T[y][x] for y in range(H) for x in range(W)]
    if WATER not in flat:
        return 0
    land_lab, nl = _labels(W, H, [t != WATER for t in flat])
    water_lab, nw = _labels(W, H, [t == WATER for t in flat])
    wsize = {}
    for v in water_lab:
        if v >= 0:
            wsize[v] = wsize.get(v, 0) + 1
    noise = _noise(W, H, 5, rng)
    opts = getattr(w, 'gen_opts', None) or {}
    lakes = opts.get('ponds_shallow', w.map_type == 'land')
    pond = {c for c, s in wsize.items() if lakes and s <= 26 and rng.random() < 0.45}
    thr = 0.5 if lakes else 0.6
    conv = []
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            i = y * W + x
            if flat[i] != WATER:
                continue
            if any(math.hypot(x - sx, y - sy) < 13 for sx, sy in starts):
                continue
            if water_lab[i] in pond:
                conv.append(i)
                continue
            # rim: land by a side; enough water around (not a narrow strait); only one land nearby
            nb = [flat[i + 1], flat[i - 1], flat[i + W], flat[i - W]]
            if LAND not in nb:
                continue
            comps = set()
            wet = 0
            for dy in (-2, -1, 0, 1, 2):
                for dx in (-2, -1, 0, 1, 2):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < W and 0 <= yy < H:
                        j = yy * W + xx
                        if flat[j] == WATER:
                            wet += 1
                        else:
                            comps.add(land_lab[j])
            if len(comps) > 1 or wet < 12:
                continue
            if noise[y][x] > thr:
                conv.append(i)
    if not conv:
        return 0
    for i in conv:
        flat[i] = SHALLOW
    # puddles of water cut off by the shallows - shallows too
    lab2, _ = _labels(W, H, [t == WATER for t in flat])
    size2 = {}
    for v in lab2:
        if v >= 0:
            size2[v] = size2.get(v, 0) + 1
    for i, v in enumerate(lab2):
        if v >= 0 and size2[v] < 12 and wsize[water_lab[i]] > size2[v]:
            flat[i] = SHALLOW
            conv.append(i)
    # check: land does not merge (islands), water does not split (except ponds that became fully shallow)
    _, nl2 = _labels(W, H, [t != WATER for t in flat])
    _, nw2 = _labels(W, H, [t == WATER for t in flat])
    if nl2 != nl or nw2 > nw - len(pond):
        if nl2 != nl:
            return 0
        # the water splits - keep only the ponds
        conv = [i for i in conv if water_lab[i] in pond]
    for i in conv:
        T[i // W][i % W] = SHALLOW
    w._naval_comps = None
    w._naval_shores = None
    return len(conv)


def _wet_vertices(w):
    """Vertices touching water/shallows or the map edge - height 0."""
    W, H = w.W, w.H
    T = w.terrain
    wet = [[False] * (W + 1) for _ in range(H + 1)]
    for y in range(H + 1):
        for x in range(W + 1):
            if x == 0 or y == 0 or x == W or y == H:
                wet[y][x] = True
                continue
            if T[y - 1][x - 1] in (WATER, SHALLOW) or T[y - 1][x] in (WATER, SHALLOW) or \
                    T[y][x - 1] in (WATER, SHALLOW) or T[y][x] in (WATER, SHALLOW):
                wet[y][x] = True
    return wet


def _lipschitz(h, S, W1, H1, rows=None):
    """The upper envelope: h[v] <= h[u] + S*distance (two passes, 8 neighbors)."""
    D = S * 1.4142
    for y in range(H1):
        r = h[y]
        p = h[y - 1] if y else None
        for x in range(W1):
            v = r[x]
            if x and r[x - 1] + S < v:
                v = r[x - 1] + S
            if p is not None:
                if p[x] + S < v:
                    v = p[x] + S
                if x and p[x - 1] + D < v:
                    v = p[x - 1] + D
                if x + 1 < W1 and p[x + 1] + D < v:
                    v = p[x + 1] + D
            r[x] = v
    for y in range(H1 - 1, -1, -1):
        r = h[y]
        n = h[y + 1] if y + 1 < H1 else None
        for x in range(W1 - 1, -1, -1):
            v = r[x]
            if x + 1 < W1 and r[x + 1] + S < v:
                v = r[x + 1] + S
            if n is not None:
                if n[x] + S < v:
                    v = n[x] + S
                if x + 1 < W1 and n[x + 1] + D < v:
                    v = n[x + 1] + D
                if x and n[x - 1] + D < v:
                    v = n[x - 1] + D
            r[x] = v


def water_rise(w):
    """A map with a sea: land rises from the shore, the beach is wider (the old "coast", islands, the DE sea)."""
    from . import maps
    return w.map_type != 'land' and maps.is_water(w.map_type)


def gen_heights(w, starts):
    """Hills by noise: plains and gentle hills up to 4-6 levels; around the starts - flat sites; by the water and
    the map edge - 0; on coastal maps the land rises from the shore."""
    rng = _rng(w, starts, 2)
    W, H = w.W, w.H
    W1, H1 = W + 1, H + 1
    amp = {'land': 1.0, 'coast': 0.85, 'islands': 0.55}.get(w.map_type, 1.0)
    opts = getattr(w, 'gen_opts', None) or {}
    share = opts.get('hill_share')          # DE maps: the share of cells on hills (Arabia 11-31 %)
    coastal = water_rise(w) and share is None   # the old "coast": land rises from the shore
    n1 = _noise(W1, H1, 12, rng)
    n2 = _noise(W1, H1, 6, rng)
    n3 = _noise(W1, H1, 21, rng)
    wet = _wet_vertices(w)
    # the distance from water (in vertices) - coastal maps rise from the shore
    INF = 10 ** 6
    dist = [[0 if wet[y][x] and 0 < x < W and 0 < y < H else INF for x in range(W1)] for y in range(H1)]
    if coastal:
        _lipschitz(dist, 1.0, W1, H1)
    h = [[0.0] * W1 for _ in range(H1)]
    if share is not None:
        # the noise threshold for the given share of hills: the top share*k vertices rise, slopes will widen them
        raw = [[(0.62 * n1[y][x] + 0.38 * n2[y][x]) * min(1.0, max(0.0, (n3[y][x] - 0.12) * 2.0))
                for x in range(W1)] for y in range(H1)]
        flat = sorted(v for r in raw for v in r)
        q = flat[max(0, min(len(flat) - 1, int(len(flat) * (1.0 - share * 1.1))))]
        top = flat[-1]
        peak = float(opts.get('peak', 5))
    for y in range(H1):
        for x in range(W1):
            if share is not None:
                v = raw[y][x]
                lv = max(0.0, v - q) / max(1e-6, top - q) * peak * 2.2 + (0.6 if v > q else 0.0)
            else:
                v = 0.62 * n1[y][x] + 0.38 * n2[y][x]
                hill = max(0.0, v - 0.46) / 0.54
                mask = min(1.0, max(0.0, (n3[y][x] - 0.22) * 2.5))       # where hills exist at all
                lv = hill * 11.0 * mask * amp       # slopes will be limited by SLOPE: hills with flat tops, as in AoE2
            if coastal and dist[y][x] < INF:
                lv += min(2.2, max(0.0, dist[y][x] - 2) * 0.16)
            h[y][x] = lv
    # flat sites at the starts (the center - at its own level, not above 2)
    for sx, sy in starts:
        cx, cy = sx + 0.5, sy + 0.5
        P = float(min(2, int(round(h[min(H, sy)][min(W, sx)]))))
        for y in range(max(0, int(cy - 16)), min(H1, int(cy + 17))):
            for x in range(max(0, int(cx - 16)), min(W1, int(cx + 17))):
                d = math.hypot(x - cx, y - cy)
                t = min(1.0, max(0.0, (d - 9.0) / 6.0))
                t = t * t * (3 - 2 * t)
                h[y][x] = P + (h[y][x] - P) * t
    for y in range(H1):
        for x in range(W1):
            if wet[y][x]:
                h[y][x] = 0.0
            elif h[y][x] > MAX_LEVEL:
                h[y][x] = float(MAX_LEVEL)
    _lipschitz(h, SLOPE, W1, H1)
    peak = max(max(r) for r in h)
    w.hz = [[v * ZL for v in r] for r in h]
    _recount(w)
    return peak


def _recount(w):
    """Recompute the integer levels of cells and the relief flag from the vertices."""
    W, H = w.W, w.H
    em = bytearray(W * H)
    for y in range(H):
        a, b = w.hz[y], w.hz[y + 1]
        for x in range(W):
            em[y * W + x] = max(0, min(MAX_LEVEL, int(round((a[x] + a[x + 1] + b[x] + b[x + 1]) * 0.25 / ZL))))
    w.elev_map = em
    w.relief = max(max(r) for r in w.hz) > 0.05 * ZL
    w._bz = {}


def set_heights(w, fn):
    """Set the vertex heights by the function fn(x, y) -> level (for tests and scenarios), then smooth the slopes."""
    h = [[float(fn(x, y)) for x in range(w.W + 1)] for y in range(w.H + 1)]
    w.hz = [[v * ZL for v in r] for r in h]
    _recount(w)


def flatten(w, x0, y0, x1, y1, level=0):
    """Make the rectangle of cells [x0, x1) x [y0, y1) flat at the level level; the surroundings are smoothed
    (slopes no steeper than SLOPE). For tests and sites."""
    W1, H1 = w.W + 1, w.H + 1
    h = [[v / ZL for v in r] for r in w.hz]
    for y in range(max(0, y0), min(H1, y1 + 1)):
        for x in range(max(0, x0), min(W1, x1 + 1)):
            h[y][x] = float(level)
    _lipschitz(h, SLOPE, W1, H1)
    w.hz = [[v * ZL for v in r] for r in h]
    _recount(w)


def gen_cliffs(w, starts):
    """Cliffs: 1-N segments along hill slopes far from the starts; each is checked - the map is not split."""
    rng = _rng(w, starts, 3)
    W, H = w.W, w.H
    T, occ = w.terrain, w.occ
    w.cliffs = []
    opts = getattr(w, 'gen_opts', None) or {}
    if rng.random() < opts.get('no_cliff', 0.25):             # on some maps there are no cliffs
        return 0
    n = len(starts)
    want = {'land': rng.randint(2, 3 + n), 'coast': rng.randint(1, 2 + n // 2),
            'islands': rng.randint(0, n // 2)}.get(w.map_type, 2)
    if 'cliffs' in opts:
        want = int(round(opts['cliffs'] * max(1.0, w.W * w.H / 14400.0) ** 0.5))
        if want <= 0:
            return 0

    def free(x, y):
        return 3 <= x < W - 3 and 3 <= y < H - 3 and T[y][x] == LAND and occ[y][x] is None

    def ok_cell(x, y):
        if not free(x, y):
            return False
        if any(math.hypot(x - sx, y - sy) < 15 for sx, sy in starts):
            return False
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                if T[y + dy][x + dx] in (WATER, SHALLOW):
                    return False
        return True

    def grad(x, y):
        hz = w.hz
        gx = (hz[y][x + 1] + hz[y + 1][x + 1]) - (hz[y][x] + hz[y + 1][x])
        gy = (hz[y + 1][x] + hz[y + 1][x + 1]) - (hz[y][x] + hz[y][x + 1])
        return gx, gy

    def walkable(x, y):
        return 0 <= x < W and 0 <= y < H and not T[y][x] & 1 and occ[y][x] is None

    def connected(cells):
        """All the passable neighbors of a segment are connected to each other (first - in the surrounding window, otherwise - across the map)."""
        cs = set(cells)
        ring = set()
        for x, y in cells:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    c = (x + dx, y + dy)
                    if c not in cs and walkable(*c):
                        ring.add(c)
        if not ring:
            return True
        for pad in (7, None):
            if pad is None:
                x0, y0, x1, y1 = 0, 0, W - 1, H - 1
            else:
                x0 = max(0, min(x for x, _ in cells) - pad)
                y0 = max(0, min(y for _, y in cells) - pad)
                x1 = min(W - 1, max(x for x, _ in cells) + pad)
                y1 = min(H - 1, max(y for _, y in cells) + pad)
            first = next(iter(ring))
            seen = {first}
            st = [first]
            while st:
                cx, cy = st.pop()
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if x0 <= nx <= x1 and y0 <= ny <= y1 and (nx, ny) not in seen and walkable(nx, ny):
                        seen.add((nx, ny))
                        st.append((nx, ny))
            if ring <= seen:
                return True
        return False

    placed = 0
    for _ in range(want * 12):
        if placed >= want:
            break
        # start - on a slope (the steepest of several random ones), along the contour line
        best = None
        for _ in range(12):
            x, y = rng.randrange(4, W - 4), rng.randrange(4, H - 4)
            if not ok_cell(x, y):
                continue
            gx, gy = grad(x, y)
            g = math.hypot(gx, gy) + rng.random() * 2
            if best is None or g > best[0]:
                best = (g, x, y, gx, gy)
        if best is None:
            continue
        _, x, y, gx, gy = best
        ang = math.atan2(gy, gx) + math.pi / 2 if (gx or gy) else rng.uniform(0, math.tau)
        L = rng.randint(6, 13)
        cells = []
        fx, fy = x + 0.5, y + 0.5
        for _ in range(L):
            c = (int(fx), int(fy))
            if not ok_cell(*c):
                break
            if c not in cells:
                if cells and abs(c[0] - cells[-1][0]) + abs(c[1] - cells[-1][1]) == 2:
                    # a diagonal step - add a corner cell so that the line is solid
                    k = (c[0], cells[-1][1])
                    if ok_cell(*k):
                        cells.append(k)
                cells.append(c)
            ang += rng.uniform(-0.35, 0.35)
            fx += math.cos(ang)
            fy += math.sin(ang)
        if len(cells) < 3:
            continue
        for x, y in cells:
            T[y][x] = CLIFF
        if not connected(cells):
            for x, y in cells:
                T[y][x] = LAND
            continue
        for x, y in cells:
            w.cliffs.append((x, y, rng.randrange(64)))
        _cliff_step(w, cells, gx, gy)
        placed += 1
    if placed:
        _recount(w)
    w._naval_comps = None
    w._naval_shores = None
    return placed


CLIFF_STEP = 1.3        # by how many levels the upper side of a cliff is higher than the lower


def _cliff_step(w, cells, gx, gy):
    """A step at a cliff (as in AoE2: a cliff separates levels): the side where the ground rises is higher by
    CLIFF_STEP right at the wall and fades smoothly over 4 tiles and beyond the segment's ends."""
    (ax, ay), (bx, by) = cells[0], cells[-1]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1.0
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux
    if nx * gx + ny * gy < 0:
        nx, ny = -nx, -ny
    cx0, cy0 = ax + 0.5, ay + 0.5
    x0 = max(1, min(x for x, _ in cells) - 6)
    x1 = min(w.W - 1, max(x for x, _ in cells) + 7)
    y0 = max(1, min(y for _, y in cells) - 6)
    y1 = min(w.H - 1, max(y for _, y in cells) + 7)
    wet = {(x, y) for y in range(y0 - 1, y1 + 1) for x in range(x0 - 1, x1 + 1)
           if 0 <= x < w.W and 0 <= y < w.H and w.terrain[y][x] in (WATER, SHALLOW)}
    for y in range(y0, y1 + 1):
        row = w.hz[y]
        for x in range(x0, x1 + 1):
            if (x, y) in wet or (x - 1, y) in wet or (x, y - 1) in wet or (x - 1, y - 1) in wet:
                continue
            px, py = x - cx0, y - cy0
            along = px * ux + py * uy
            side = px * nx + py * ny
            if side <= -0.2:
                continue
            d = min(math.hypot(x - cx - 0.5, y - cy - 0.5) for cx, cy in cells)
            k = max(0.0, min(1.0, 1.0 - (d - 0.8) / 4.0))
            out = max(-along, along - L, 0.0)
            e = max(0.0, 1.0 - out / 2.5)
            t = min(1.0, (side + 0.2) / 0.6)
            v = CLIFF_STEP * k * e * t
            if v > 0:
                row[x] = min(MAX_LEVEL * ZL, row[x] + v * ZL)


def gen_ground(w, starts):
    """Ground types by cell: grass of three shades in patches, earth by the starts and mines, patches of dry earth,
    forest floor under trees (conifer - under pines/firs), sand by the water, stones under cliffs."""
    rng = _rng(w, starts, 4)
    W, H = w.W, w.H
    T = w.terrain
    gr = bytearray(W * H)
    n1 = _noise(W, H, 9, rng)
    n3 = _noise(W, H, 11, rng)
    n4 = _noise(W, H, 4, rng)
    for y in range(H):
        for x in range(W):
            t = T[y][x]
            i = y * W + x
            if t == WATER:
                gr[i] = G['water']
                continue
            if t == SHALLOW:
                gr[i] = G['shallow']
                continue
            g = 'grass'             # grass shades - in smooth patches at draw time (terrain_gfx)
            if n3[y][x] > 0.7 and n4[y][x] > 0.5:
                g = 'dirt3' if n3[y][x] < 0.78 or n1[y][x] < 0.55 else 'dirt2'
            gr[i] = G[g]
    # earth around the starts (the foundation of the center) and mines
    for sx, sy in starts:
        for y in range(sy - 8, sy + 9):
            for x in range(sx - 8, sx + 9):
                if 0 <= x < W and 0 <= y < H and T[y][x] == LAND:
                    d = math.hypot(x - sx, y - sy) + (n4[y][x] - 0.5) * 2.5
                    if d < 4.2:
                        gr[y * W + x] = G['dirt']
                    elif d < 6.3:
                        gr[y * W + x] = G['dirt2'] if gr[y * W + x] != G['dirt'] else gr[y * W + x]
    for nd in w.nodes:
        if nd.kind in ('gold', 'stone'):
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    x, y = nd.tx + dx, nd.ty + dy
                    if 0 <= x < W and 0 <= y < H and T[y][x] == LAND and (dx == dy == 0 or rng.random() < 0.8):
                        gr[y * W + x] = G['dirt2'] if nd.kind == 'gold' else G['dirt3']
    from . import themes            # landscape: tree species and the conifer floor under them
    for nd in w.nodes:
        if nd.kind == 'tree' and 0 <= nd.tx < W and 0 <= nd.ty < H:
            sp = themes.tree_species(w, nd.tx, nd.ty)
            gr[nd.ty * W + nd.tx] = G['pine'] if themes.is_conifer(w, sp) else G['forest']
    # sand by the water (the beach is wider by the sea)
    wide = water_rise(w)
    for y in range(H):
        for x in range(W):
            if T[y][x] not in (LAND, CLIFF):
                continue
            near = 0
            for dy in (-2, -1, 0, 1, 2):
                for dx in (-2, -1, 0, 1, 2):
                    xx, yy = x + dx, y + dy
                    if 0 <= xx < W and 0 <= yy < H and T[yy][xx] in (WATER, SHALLOW):
                        near = max(near, 3 - max(abs(dx), abs(dy)))
            if near >= 2 or (near == 1 and wide and n4[y][x] > 0.4):
                g = gr[y * W + x]
                if g not in (G['forest'], G['pine']):
                    gr[y * W + x] = G['beach'] if wide else G['sand']
    for x, y, _ in w.cliffs:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                xx, yy = x + dx, y + dy
                if 0 <= xx < W and 0 <= yy < H and T[yy][xx] in (LAND, CLIFF) and \
                        (dx == dy == 0 or rng.random() < 0.3):
                    gr[yy * W + xx] = G['rocky']
    w.ground = gr
