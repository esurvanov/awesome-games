"""Рельеф как в AoE II DE: высоты 0–7, обрывы, мелководье, типы земли (без pygame — это часть мира).

Коды клеток world.terrain:  0 — суша, 1 — вода, 2 — мелководье (ходят пешие, не плавают корабли, строить
нельзя), 3 — обрыв (непроходим). Проходимость для пеших — чётный код (t & 1 == 0).

Высота хранится в вершинах клеток: world.hz[(H+1)][(W+1)] — пиксели экрана (уровень × ZL); по клетке —
билинейно, как её рисует земля (game/terrain_gfx.py). Целый уровень клетки (0..7, для правил боя и
стройки) — world.elev[ty*W + tx] = округлённое среднее четырёх углов.

Единый способ «точка мира → экран с высотой» для всего кода отрисовки:
  terrain.ZL                    — пикселей экрана на уровень (16 = HH: у классики 24 px при клетке 96 px, у нас 64)
  World.z_at(x, y)              — высота земли под точкой мира (логические px) в пикселях экрана
  World.elev(tx, ty)            — целый уровень клетки
  data.to_iso(x, y, ox, z)      — мир → изометрическая карта, поднятая на z пикселей
  Game.w2s(x, y, z=None)        — мир → экран; z по умолчанию — высота земли в точке
  Game.s2w(sx, sy)              — экран → мир с учётом рельефа (точка земли под курсором)
"""
import math
import random

from .data import TILE, HH

ZL = HH                 # пикселей экрана на уровень высоты
MAX_LEVEL = 7
SLOPE = 0.7             # предел разницы соседних вершин (уровней на клетку): склоны не «складываются»
BUILD_SLOPE = 1.0       # здание: перепад высот углов основания не больше уровня (AoE2 — лёгкие склоны можно)
HEIGHT_BONUS = 0.25     # ±25 % урона сверху вниз / снизу вверх (AoE II DE)

LAND, WATER, SHALLOW, CLIFF = 0, 1, 2, 3

# типы земли (world.ground) — для текстур и смешения; порядок смешения — PRIORITY (выше — поверх)
GROUNDS = ('grass', 'grass2', 'grass3', 'dirt', 'dirt2', 'dirt3', 'forest', 'pine', 'sand', 'beach',
           'shallow', 'water', 'rocky')
G = {n: i for i, n in enumerate(GROUNDS)}
PRIORITY = ('water', 'shallow', 'beach', 'sand', 'grass', 'grass2', 'grass3', 'dirt3', 'dirt2', 'dirt', 'rocky',
            'pine', 'forest')
# цвет миникарты по типу (как в AoE2: трава зелёная, земля охра, лес тёмно-зелёный, песок светлый)
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
    """Порода дерева на клетке: пятна 7×7 одной породы с примесью. names — доступные породы (по умолчанию все)."""
    names = [(n, w) for n, w in _SPECIES_W if names is None or n in names]
    if not names:
        return None
    rx, ry = tx // 7, ty // 7
    if _hash(tx, ty, 5) % 4 == 0:           # границы пятен чуть неровные
        rx, ry = (tx + 3) // 7, (ty + 3) // 7
    tot = sum(w for _, w in names)
    r = _hash(rx, ry, 1) % tot
    sp = names[-1][0]
    for n, w in names:
        if r < w:
            sp = n
            break
        r -= w
    if _hash(tx, ty, 9) % 5 == 0:          # примесь другой породы
        sp = names[_hash(tx, ty, 11) % len(names)][0]
    return sp


# ============================================================ состояние мира
def ensure(w):
    """Плоский рельеф по умолчанию (старые сохранения, миры тестов до генерации)."""
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
        w.theme = 'grass'           # пейзаж (game/themes.py); старые сохранения — прежний облик


def z_at(w, x, y):
    """Высота земли (px экрана) под точкой мира (x, y в логических px) — билинейно по вершинам."""
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
    """(min, max) высоты углов клеток основания (уровни)."""
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
    """Можно ли ставить здание: перепад высот по основанию ≤ BUILD_SLOPE уровня."""
    if not w.relief:
        return True
    lo, hi = footprint_range(w, tx, ty, sw, sw if sh is None else sh)
    return hi - lo <= BUILD_SLOPE + 1e-6


def height_mult(w, att, target):
    """Множитель урона за высоту: ×1.25 сверху вниз, ×0.75 снизу вверх (разница целых уровней клеток)."""
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
    """Средняя высота углов основания (px) — на ней стоит здание (кэш: рельеф неизменен)."""
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
    """Экран без сдвига камеры (ix, iy — изометрия, поднятая рельефом) → точка земли мира (x, y).
    Ищем точку столбца, у которой iy_плоск − z = iy: итерация iy_плоск = iy + z (склоны < 1 → сходится)."""
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


# ============================================================ генерация
def _rng(w, starts, salt):
    s = w.W * 7919 + salt * 104729 + len(starts) * 31 + sum(len(x) for x in (w.map_type,))
    for i, (x, y) in enumerate(starts):
        s = (s * 1000003 + x * 131 + y * 17 + i) & 0xffffffffffff
    return random.Random(s)


def _noise(W, H, cell, rng):
    """Плавный шум значений (H строк × W столбцов, 0..1)."""
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
    """Компоненты связности (по сторонам) клеток, где ok[i] истинно: список меток (-1 — не та клетка), число."""
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
    """Мелководье: часть кромки озёр и берегов (пешие переходят, корабли — нет). Проливы не перекрываются,
    острова не соединяются, связность воды не рвётся."""
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
            # кромка: суша по стороне; вокруг достаточно воды (не узкий пролив); рядом только одна суша
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
    # отрезанные мелководьем лужицы воды — тоже мелководье
    lab2, _ = _labels(W, H, [t == WATER for t in flat])
    size2 = {}
    for v in lab2:
        if v >= 0:
            size2[v] = size2.get(v, 0) + 1
    for i, v in enumerate(lab2):
        if v >= 0 and size2[v] < 12 and wsize[water_lab[i]] > size2[v]:
            flat[i] = SHALLOW
            conv.append(i)
    # проверка: суша не сливается (острова), вода не делится (кроме целиком обмелевших прудов)
    _, nl2 = _labels(W, H, [t != WATER for t in flat])
    _, nw2 = _labels(W, H, [t == WATER for t in flat])
    if nl2 != nl or nw2 > nw - len(pond):
        if nl2 != nl:
            return 0
        # делится вода — оставляем только пруды
        conv = [i for i in conv if water_lab[i] in pond]
    for i in conv:
        T[i // W][i % W] = SHALLOW
    w._naval_comps = None
    w._naval_shores = None
    return len(conv)


def _wet_vertices(w):
    """Вершины, касающиеся воды/мелководья или края карты — высота 0."""
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
    """Верхняя огибающая: h[v] ≤ h[u] + S·расстояние (два прохода, 8 соседей)."""
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
    """Карта с морем: суша поднимается от берега, пляж шире (старое «прибрежье», острова, море DE)."""
    from . import maps
    return w.map_type != 'land' and maps.is_water(w.map_type)


def gen_heights(w, starts):
    """Холмы шумом: равнины и пологие холмы до 4–6 уровней; вокруг стартов — ровные площадки; у воды и
    края карты — 0; на прибрежных картах суша поднимается от берега."""
    rng = _rng(w, starts, 2)
    W, H = w.W, w.H
    W1, H1 = W + 1, H + 1
    amp = {'land': 1.0, 'coast': 0.85, 'islands': 0.55}.get(w.map_type, 1.0)
    opts = getattr(w, 'gen_opts', None) or {}
    share = opts.get('hill_share')          # карты DE: доля клеток на холмах (Arabia 11–31 %)
    coastal = water_rise(w) and share is None   # старое «прибрежье»: суша поднимается от берега
    n1 = _noise(W1, H1, 12, rng)
    n2 = _noise(W1, H1, 6, rng)
    n3 = _noise(W1, H1, 21, rng)
    wet = _wet_vertices(w)
    # расстояние от воды (в вершинах) — прибрежные карты поднимаются от берега
    INF = 10 ** 6
    dist = [[0 if wet[y][x] and 0 < x < W and 0 < y < H else INF for x in range(W1)] for y in range(H1)]
    if coastal:
        _lipschitz(dist, 1.0, W1, H1)
    h = [[0.0] * W1 for _ in range(H1)]
    if share is not None:
        # порог шума под заданную долю холмов: верхние share·k вершин поднимаются, склоны расширят их
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
                mask = min(1.0, max(0.0, (n3[y][x] - 0.22) * 2.5))       # где холмы вообще есть
                lv = hill * 11.0 * mask * amp       # склоны ограничит SLOPE: холмы с ровным верхом, как в AoE2
            if coastal and dist[y][x] < INF:
                lv += min(2.2, max(0.0, dist[y][x] - 2) * 0.16)
            h[y][x] = lv
    # ровные площадки у стартов (центр — на своём уровне, не выше 2)
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
    """Пересчитать целые уровни клеток и признак рельефа по вершинам."""
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
    """Задать высоты вершин функцией fn(x, y) → уровень (для тестов и сценариев), затем сгладить склоны."""
    h = [[float(fn(x, y)) for x in range(w.W + 1)] for y in range(w.H + 1)]
    w.hz = [[v * ZL for v in r] for r in h]
    _recount(w)


def flatten(w, x0, y0, x1, y1, level=0):
    """Сделать ровным прямоугольник клеток [x0, x1) × [y0, y1) на уровне level; окрестность сглаживается
    (склоны не круче SLOPE). Для тестов и площадок."""
    W1, H1 = w.W + 1, w.H + 1
    h = [[v / ZL for v in r] for r in w.hz]
    for y in range(max(0, y0), min(H1, y1 + 1)):
        for x in range(max(0, x0), min(W1, x1 + 1)):
            h[y][x] = float(level)
    _lipschitz(h, SLOPE, W1, H1)
    w.hz = [[v * ZL for v in r] for r in h]
    _recount(w)


def gen_cliffs(w, starts):
    """Обрывы: 1–N отрезков по склонам холмов вдалеке от стартов; каждый проверяется — карта не делится."""
    rng = _rng(w, starts, 3)
    W, H = w.W, w.H
    T, occ = w.terrain, w.occ
    w.cliffs = []
    opts = getattr(w, 'gen_opts', None) or {}
    if rng.random() < opts.get('no_cliff', 0.25):             # на части карт обрывов нет
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
        """Все проходимые соседи отрезка связаны между собой (сначала — в окне вокруг, иначе — по карте)."""
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
        # старт — на склоне (самый крутой из нескольких случайных), вдоль горизонтали
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
                    # диагональный шаг — добавляем угловую клетку, чтобы линия была сплошной
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


CLIFF_STEP = 1.3        # на сколько уровней верхняя сторона обрыва выше нижней


def _cliff_step(w, cells, gx, gy):
    """Ступень у обрыва (как в AoE2: обрыв разделяет уровни): сторона, куда земля поднимается, выше на
    CLIFF_STEP у самой стены и плавно сходит на нет за 4 клетки и за концами отрезка."""
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
    """Типы земли по клеткам: трава трёх оттенков пятнами, земля у стартов и шахт, пятна сухой земли,
    лесная подстилка под деревьями (хвойная — под соснами/елями), песок у воды, камни под обрывами."""
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
            g = 'grass'             # оттенки травы — плавными пятнами при отрисовке (terrain_gfx)
            if n3[y][x] > 0.7 and n4[y][x] > 0.5:
                g = 'dirt3' if n3[y][x] < 0.78 or n1[y][x] < 0.55 else 'dirt2'
            gr[i] = G[g]
    # земля вокруг стартов (фундамент центра) и шахт
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
    from . import themes            # пейзаж: породы деревьев и хвойная подстилка под ними
    for nd in w.nodes:
        if nd.kind == 'tree' and 0 <= nd.tx < W and 0 <= nd.ty < H:
            sp = themes.tree_species(w, nd.tx, nd.ty)
            gr[nd.ty * W + nd.tx] = G['pine'] if themes.is_conifer(w, sp) else G['forest']
    # песок у воды (пляж — у моря шире)
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
