"""Генератор случайных карт по правилам AoE II DE (свой код по числам из скриптов карт DE —
docs/research/07_maps.md; ни текстов, ни файлов DE в игре нет).

Общее для всех карт (как в DE):
  • размер — match.MAP_SIZE (120/144/168/200/220/240), число объектов масштабируется по площади (×W·H/10 000);
  • старты — на круге радиуса 33–38 % стороны со случайным поворотом, союзники рядом («Команды рядом»);
  • набор игрока — одинаковые количества на одинаковых расстояниях (от центра ЦГ до ближайшей клетки
    группы), направления у каждого свои (как set_place_for_every_player + min/max_distance_to_players);
  • леса игрока и рощи — сплошные пятна, края карты открыты (кроме карт, где лес — основа);
  • волки (≥ 32 клеток от игроков), реликвии, одиночные деревья у центра.
Рецепты карт — функции _arabia, _arena, _black_forest, _nomad, _islands, _mediterranean.

Точка входа: generate(w) — из World.gen_map для карт из maps.MAPS (кроме старых 'land' / 'coast').
Случайность — модуль random (World(...) после random.seed(n) воспроизводим).
"""
import math
import random

from .data import TILE, ANIMALS
from . import terrain, maps
from .world import Node, Unit, Animal

LAND, WATER, SHALLOW, CLIFF = 0, 1, 2, 3
# флаги сетки занятости генератора
F_FOREST, F_RES, F_CLEAR, F_WALL = 1, 2, 4, 8

# DE: радиус круга стартов (доля стороны) по размеру карты — Arabia.rms (tiny 32–34 %, … huge 38 %)
RADIUS = ((120, 0.33), (144, 0.34), (168, 0.35), (200, 0.36), (220, 0.37), (240, 0.38))
# DE: реликвий по размеру карты (5/5/5/7/8/9)
RELICS = ((120, 5), (144, 5), (168, 5), (200, 7), (220, 8), (240, 9))
STRAGGLER_WOOD = 125        # одиночное дерево (dat 410)


def _by_size(table, W):
    best = table[0][1]
    for side, v in table:
        if W >= side - 6:
            best = v
    return best


def circle_radius(W, extra=0.0):
    return W * (_by_size(RADIUS, W) + extra)


# ============================================================ генератор
class Gen:
    def __init__(self, w):
        self.w = w
        self.W, self.H = w.W, w.H
        self.T = w.terrain
        self.n = len(w.players)
        self.flags = bytearray(self.W * self.H)
        self.scale = self.W * self.H / 10000.0
        self.mx, self.my = (self.W - 1) / 2, (self.H - 1) / 2
        self.starts = []
        self.angs = []
        self.fwd = []

    # ---------------------------------------------------------------- базовое
    def inb(self, x, y, m=0):
        return m <= x < self.W - m and m <= y < self.H - m

    def flag(self, x, y):
        return self.flags[y * self.W + x]

    def setf(self, x, y, f):
        self.flags[y * self.W + x] |= f

    def dstart(self, x, y):
        return min(math.hypot(x - sx, y - sy) for sx, sy in self.starts)

    def near_flag(self, x, y, r, f):
        """Есть ли клетка с флагом f в радиусе r (квадрат окрестности)."""
        W, H = self.W, self.H
        fl = self.flags
        for yy in range(max(0, y - r), min(H, y + r + 1)):
            row = yy * W
            for xx in range(max(0, x - r), min(W, x + r + 1)):
                if fl[row + xx] & f:
                    return True
        return False

    def near_water(self, x, y, r):
        T = self.T
        for yy in range(max(0, y - r), min(self.H, y + r + 1)):
            for xx in range(max(0, x - r), min(self.W, x + r + 1)):
                if T[yy][xx] in (WATER, SHALLOW):
                    return True
        return False

    def free_land(self, x, y):
        return self.inb(x, y) and self.T[y][x] == LAND and self.w.occ[y][x] is None

    def land_id(self, x, y):
        """Номер компоненты суши (для островов: ресурс игрока — на его острове)."""
        lab = self._land_lab
        return lab[y * self.W + x] if lab is not None else 0

    _land_lab = None

    def label_land(self):
        W, H = self.W, self.H
        ok = [self.T[i // W][i % W] != WATER for i in range(W * H)]
        self._land_lab, _ = terrain._labels(W, H, ok)

    # ---------------------------------------------------------------- старты
    def place_starts(self, frac_extra=0.0, radius=None, jitter=1.0):
        """Круг со случайным поворотом; союзники — на соседних местах круга."""
        w, n = self.w, self.n
        R = radius if radius is not None else circle_radius(self.W, frac_extra)
        base = random.uniform(0, math.tau)
        together = w.settings.get('team_together', True)
        order = sorted(range(n), key=lambda pid: (w.players[pid].team if together else 0, random.random()))
        self.starts = [None] * n
        self.angs = [0.0] * n
        for slot, pid in enumerate(order):
            a = base + slot * math.tau / n + random.uniform(-0.04, 0.04) * jitter
            r = R + random.uniform(-1.0, 1.0) * jitter
            x = int(round(self.mx + math.cos(a) * r))
            y = int(round(self.my + math.sin(a) * r))
            self.starts[pid] = (max(8, min(self.W - 9, x)), max(8, min(self.H - 9, y)))
            self.angs[pid] = a
        self.fwd = [a + math.pi for a in self.angs]
        self.R = R
        w.starts = self.starts
        for sx, sy in self.starts:            # площадка центра: без леса и куч
            for y in range(sy - 4, sy + 5):
                for x in range(sx - 4, sx + 5):
                    if self.inb(x, y):
                        self.setf(x, y, F_CLEAR)

    # ---------------------------------------------------------------- формы
    def grow(self, seed, k, ok, clump=0.75):
        """Сплошное пятно из k клеток от seed (DE: create_terrain с clumping_factor): чаще растёт туда,
        где у клетки больше соседей пятна — края неровные, но без дыр."""
        if not ok(*seed):
            return []
        cells = [seed]
        got = {seed}
        front = {}

        def push(c):
            x, y = c
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nb = (x + d[0], y + d[1])
                if nb not in got:
                    front[nb] = front.get(nb, 0) + 1

        push(seed)
        bad = set()
        while len(cells) < k and front:
            keys = list(front)
            if random.random() < clump:
                mx = max(front[c] for c in keys)
                pool = [c for c in keys if front[c] >= mx - (1 if mx > 2 else 0)]
            else:
                pool = keys
            c = random.choice(pool)
            del front[c]
            if c in bad or not ok(*c):
                bad.add(c)
                continue
            got.add(c)
            cells.append(c)
            push(c)
        return cells

    def blob(self, seed, k, ok, aspect=(1.0, 2.5), rough=0.35):
        """Пятно из k клеток неровной вытянутой формы (лесополоса / пруд / островок): эллипс со случайным
        поворотом и шумной кромкой; клетки берутся по «радиусу» от центра и только связно с уже взятыми."""
        if not ok(*seed):
            return []
        asp = random.uniform(*aspect)
        a = math.sqrt(k * asp / math.pi)
        b = max(1.0, k / (math.pi * a))
        ang = random.uniform(0, math.pi)
        ca, sa = math.cos(ang), math.sin(ang)
        ph = [random.uniform(0, math.tau) for _ in range(4)]
        fr = [random.randint(2, 4), random.randint(5, 8)]
        R = int(a * 1.6) + 3
        cx, cy = seed
        cand = []
        for dy in range(-R, R + 1):
            for dx in range(-R, R + 1):
                u = (dx * ca + dy * sa) / a
                v = (-dx * sa + dy * ca) / b
                t = math.atan2(v, u)
                r = math.hypot(u, v) / (1 + rough * (0.6 * math.sin(fr[0] * t + ph[0]) +
                                                     0.4 * math.sin(fr[1] * t + ph[1])))
                cand.append((r + random.uniform(0, 0.08), cx + dx, cy + dy))
        cand.sort()
        got = {seed}
        cells = [seed]
        pending = [c for c in cand if (c[1], c[2]) != seed]
        for _ in range(6):                  # несколько проходов: клетка берётся, когда у неё есть сосед в пятне
            rest = []
            for r, x, y in pending:
                if len(cells) >= k:
                    break
                if not any((x + ddx, y + ddy) in got for ddx, ddy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    rest.append((r, x, y))
                    continue
                if not ok(x, y):
                    continue
                got.add((x, y))
                cells.append((x, y))
            if len(cells) >= k or not rest:
                break
            pending = rest
        return cells

    def tight(self, cx, cy, k, ok):
        """Плотная куча (DE set_tight_grouping): k ближайших к центру клеток с небольшим разбросом, связная."""
        cand = []
        r = int(math.sqrt(k)) + 2
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                cand.append((math.hypot(dx, dy) + random.uniform(0, 0.9), cx + dx, cy + dy))
        cand.sort()
        got = []
        gs = set()
        for _, x, y in cand:
            if len(got) >= k:
                break
            if not ok(x, y):
                continue
            if got and not any((x + dx, y + dy) in gs for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                continue
            got.append((x, y))
            gs.add((x, y))
        return got if len(got) == k else None

    # ---------------------------------------------------------------- объекты
    def put_node(self, kind, x, y, amount=None):
        nd = Node(kind, x, y)
        if amount is not None:
            nd.amount = nd.max_amount = amount
        self.w.nodes.append(nd)
        self.w.occ[y][x] = nd
        self.setf(x, y, F_FOREST if kind == 'tree' else F_RES)
        return nd

    def res_ok(self, x, y, gap=3, forest_gap=2):
        """Клетка под кучу ресурса: суша, свободна, не у воды, в стороне от других куч и леса."""
        if not self.inb(x, y, 2) or self.T[y][x] != LAND or self.w.occ[y][x] is not None:
            return False
        if self.flag(x, y) & (F_CLEAR | F_WALL):
            return False
        if gap and self.near_flag(x, y, gap, F_RES):
            return False
        if forest_gap and self.near_flag(x, y, forest_gap, F_FOREST):
            return False
        return not self.near_water(x, y, 1)

    def spot(self, pid, dmin, dmax, ok, own=0.0, edge=3, tries=160, ang=None):
        """Случайная точка на расстоянии [dmin, dmax] от старта pid, ближе к нему, чем к чужим
        (own — запас в клетках), на той же суше. None — не нашлось."""
        sx, sy = self.starts[pid]
        home = self.land_id(sx, sy)
        for _ in range(tries):
            a = random.uniform(0, math.tau) if ang is None else ang + random.uniform(-0.5, 0.5)
            d = random.uniform(dmin, dmax)
            x, y = int(round(sx + math.cos(a) * d)), int(round(sy + math.sin(a) * d))
            if not self.inb(x, y, edge):
                continue
            if not ok(x, y):
                continue
            if self.land_id(x, y) != home:
                continue
            if own is not None and any(math.hypot(x - ox, y - oy) < d + own
                                       for q, (ox, oy) in enumerate(self.starts) if q != pid):
                continue
            return x, y
        return None

    def pile(self, pid, kind, k, d, spread=1.5, gap=3, own=2.0, edge=4, amount=None, land_any=False):
        """Куча k клеток ресурса игрока pid: ближайшая клетка — на расстоянии d ± spread от старта."""
        sx, sy = self.starts[pid]

        def ok(x, y):
            return self.res_ok(x, y, gap)

        for attempt in range(4):
            sp = spread + attempt * 1.5
            g = max(1, gap - attempt)
            own_a = own if attempt < 3 else None

            def okg(x, y, g=g):
                return self.res_ok(x, y, g)

            for _ in range(60):
                c = self.spot(pid, d - sp + 1, d + sp + 1.5, okg, own=own_a, edge=edge, tries=20)
                if c is None:
                    continue
                cells = self.tight(c[0], c[1], k, okg)
                if not cells:
                    continue
                dn = min(math.hypot(x - sx, y - sy) for x, y in cells)
                if abs(dn - d) > sp:
                    continue
                if not land_any and len({self.land_id(x, y) for x, y in cells}) > 1:
                    continue
                for x, y in cells:
                    self.put_node(kind, x, y, amount)
                return cells
        return None

    def herd(self, pid, kind, k, d, spread=2.0, owner=-1, gap=2):
        """Стадо k животных (овцы, олени) на расстоянии d ± spread; кабан — k = 1."""
        sx, sy = self.starts[pid]

        def ok(x, y):
            return self.free_land(x, y) and not self.flag(x, y) & (F_WALL | F_FOREST) and \
                not self.near_flag(x, y, 1, F_FOREST | F_RES)

        for attempt in range(3):
            c = self.spot(pid, d - spread - attempt * 2, d + spread + attempt * 2, ok,
                          own=2.0 if attempt < 2 else None, edge=3)
            if c is None:
                continue
            placed = []
            for i in range(k):
                x, y = c[0] + (i % 2), c[1] + (i // 2)
                if not ok(x, y):
                    x, y = self.w.nearest_free_tile(*c)
                placed.append((x, y))
            for x, y in placed:
                self.animal(kind, x, y, owner)
            return placed
        return None

    def animal(self, kind, x, y, owner=-1):
        if kind not in ANIMALS:
            return None
        a = Animal(kind, (x + 0.5) * TILE, (y + 0.5) * TILE, self.w, owner)
        self.w.animals.append(a)
        return a

    # ---------------------------------------------------------------- лес
    def forest_ok(self, x, y, keep=None):
        if not self.inb(x, y) or self.T[y][x] != LAND or self.w.occ[y][x] is not None:
            return False
        if self.flag(x, y) & (F_CLEAR | F_WALL | F_RES):
            return False
        if keep is not None and self.dstart(x, y) < keep:
            return False
        return True

    def forest(self, seed, k, keep=None, clump=0.6, gap=1, aspect=(1.3, 3.2)):
        def ok(x, y):
            if not self.forest_ok(x, y, keep):
                return False
            return not (gap and self.near_flag(x, y, gap, F_RES))
        cells = self.blob(seed, k, ok, aspect) if aspect else self.grow(seed, k, ok, clump)
        for x, y in cells:
            self.put_node('tree', x, y)
        return cells

    def player_forests(self, cnt, size, dist, keep=8.5):
        """Леса игрока (DE PLAYER_FOREST): cnt = (от, до) лесов по size = (от, до) клеток на dist = (от, до)."""
        k = random.randint(*cnt)
        sizes = [random.randint(*size) for _ in range(k)]
        for pid in range(self.n):
            used = []
            for s in sizes:
                for _ in range(40):
                    c = self.spot(pid, dist[0], dist[1],
                                  lambda x, y: self.forest_ok(x, y, keep) and not self.near_flag(x, y, 3, F_RES),
                                  own=3.0, edge=2, tries=10)
                    if c is None:
                        continue
                    if any(math.hypot(c[0] - ux, c[1] - uy) < 9 for ux, uy in used):
                        continue
                    self.forest(c, s, keep=keep)
                    used.append(c)
                    break

    def groves(self, count, size, keep=15, sep=10):
        """Рощи по карте вдали от игроков (DE: N рощ по M клеток, avoid players)."""
        placed = []
        for _ in range(count):
            for _ in range(60):
                x, y = random.randrange(3, self.W - 3), random.randrange(3, self.H - 3)
                if not self.forest_ok(x, y, keep) or self.near_flag(x, y, 3, F_RES):
                    continue
                if any(math.hypot(x - a, y - b) < sep for a, b in placed):
                    continue
                self.forest((x, y), random.randint(*size), keep=keep, aspect=(1.0, 2.4))
                placed.append((x, y))
                break
        return placed

    def stragglers(self, k=5, dmin=5.5, dmax=8.5):
        """Одиночные деревья у центра (DE stragglers.inc: 5 штук, ≥ 5 клеток от ЦГ, 125 дерева)."""
        for pid, (sx, sy) in enumerate(self.starts):
            got = []
            for _ in range(200):
                if len(got) >= k:
                    break
                a = random.uniform(0, math.tau)
                d = random.uniform(dmin, dmax)
                x, y = int(round(sx + math.cos(a) * d)), int(round(sy + math.sin(a) * d))
                if not self.inb(x, y, 2) or self.T[y][x] != LAND or self.w.occ[y][x] is not None:
                    continue
                if self.flag(x, y) & (F_WALL | F_RES) or self.near_flag(x, y, 1, F_RES | F_FOREST):
                    continue
                if any(abs(x - gx) + abs(y - gy) < 3 for gx, gy in got):
                    continue
                self.put_node('tree', x, y, STRAGGLER_WOOD)
                got.append((x, y))

    # ---------------------------------------------------------------- стандартный набор игрока
    def package(self, pk):
        """pk — список (вид, число, расстояние[, опции]); порядок — как в DE: сначала крупное."""
        for item in pk:
            kind, k, d = item[:3]
            opt = item[3] if len(item) > 3 else {}
            for pid in range(self.n):
                if kind in ('gold', 'stone', 'berries'):
                    self.pile(pid, kind, k, d, **opt)
                elif kind in ('sheep_own',):
                    self.herd(pid, 'sheep', k, d, spread=1.0, owner=pid)
                else:
                    kk = random.randint(*k) if isinstance(k, tuple) else k
                    self.herd(pid, kind, kk, d, **opt)

    # ---------------------------------------------------------------- дальние объекты
    def scatter(self, what, count, min_players, sep, ok=None, edge=10):
        """count объектов what(x, y) по карте: ≥ min_players от всех стартов, ≥ sep друг от друга."""
        placed = []
        ok = ok or (lambda x, y: self.free_land(x, y) and not self.flag(x, y) & (F_FOREST | F_RES | F_WALL))
        for i in range(count):
            for attempt in range(300):
                lim = min_players * (1.0 if attempt < 200 else 0.75)
                x, y = random.randrange(edge, self.W - edge), random.randrange(edge, self.H - edge)
                if not ok(x, y) or self.dstart(x, y) < lim:
                    continue
                if any(math.hypot(x - a, y - b) < sep for a, b in placed):
                    continue
                if what(x, y) is False:
                    continue
                placed.append((x, y))
                break
        return placed

    def wolves(self, per_area=4.0, min_players=32, sep=16):
        if 'wolf' not in ANIMALS or per_area <= 0:
            return []
        k = max(2, int(round(per_area * self.scale)))
        return self.scatter(lambda x, y: self.animal('wolf', x, y), k, min_players, sep)

    def relics(self, min_players=32, sep=20, count=None, open_r=1):
        try:
            from . import relics
        except ImportError:
            return []
        k = count if count is not None else _by_size(RELICS, self.W)

        def put(x, y):
            relics.spawn(self.w, x, y)
            self.setf(x, y, F_RES)

        ok = (lambda x, y: self.free_land(x, y) and not self.flag(x, y) & (F_FOREST | F_RES | F_WALL)
              and not (open_r and self.near_flag(x, y, open_r, F_FOREST)))
        got = self.scatter(put, k, min_players, sep, ok=ok, edge=6)
        if len(got) < k:        # не влезли — ближе к игрокам (но не у самого центра)
            got += self.scatter(put, k - len(got), min_players * 0.6, sep * 0.6, ok=ok, edge=4)
        return got

    def far_piles(self, kind, k, d, spread=5, edge=10):
        """Дальняя куча (DE: 3 золота на 46, ≥ 10 от края) — по одной на игрока."""
        for pid in range(self.n):
            self.pile(pid, kind, k, d, spread=spread, own=-6.0, edge=edge)

    # ---------------------------------------------------------------- старт: ЦГ, жители, разведчик
    def start_units(self, tc=True):
        w = self.w
        for pid, (cx, cy) in enumerate(self.starts):
            fwd = self.fwd[pid]
            ox = 1 if math.cos(fwd) >= 0 else -1
            oy = 1 if math.sin(fwd) >= 0 else -1
            if tc:
                b = w.place_building('town_center', pid, cx - 2, cy - 2, complete=True)
                b.rally = None
                spots = [(cx + 3 * ox, cy), (cx, cy + 3 * oy), (cx + 3 * ox, cy + 3 * oy)]
                scout = (cx - 3 * ox, cy + 3 * oy)
            else:
                # кочевье: три жителя вразброс вдоль круга стартов (DE nomad: далеко друг от друга)
                a = self.angs[pid]
                spots = [(cx, cy)]
                for s in (-1, 1):
                    b2 = a + s * 15.0 / max(10.0, self.R)
                    spots.append((int(round(self.mx + math.cos(b2) * self.R)),
                                  int(round(self.my + math.sin(b2) * self.R))))
                scout = (cx + ox * 2, cy + oy * 2)
            for tx, ty in spots:
                tx, ty = w.nearest_free_tile(tx, ty)
                w.units.append(Unit('villager', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w))
            tx, ty = w.nearest_free_tile(*scout)
            w.units.append(Unit('scout', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, w))

    # ---------------------------------------------------------------- вода
    def pond(self, cx, cy, k):
        """Пруд из k клеток (DE: create_land/terrain WATER малый)."""
        def ok(x, y):
            return self.inb(x, y, 3) and self.T[y][x] == LAND and self.dstart(x, y) > 16 and \
                not self.flag(x, y) & (F_CLEAR | F_WALL)
        cells = self.blob((cx, cy), k, ok, aspect=(1.0, 2.2), rough=0.3)
        for x, y in cells:
            self.T[y][x] = WATER
        return cells

    def fish(self, shore=(2, 3), deep=3, dmax=40, extra_deep=0):
        """Рыба поровну: shore = (стаек, рыб в стайке) у ближайшего берега, deep — глубоководная подальше."""
        w = self.w
        W, H = self.W, self.H
        T = self.T

        def water_free(x, y):
            return self.inb(x, y) and T[y][x] == WATER and w.occ[y][x] is None

        def coast(x, y):
            return water_free(x, y) and any(self.inb(x + dx, y + dy) and T[y + dy][x + dx] in (LAND, SHALLOW)
                                            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))

        def open_(x, y):
            return water_free(x, y) and all(self.inb(x + dx, y + dy) and T[y + dy][x + dx] == WATER
                                            for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2))

        def put(kind, x, y):
            nd = Node(kind, x, y)
            w.nodes.append(nd)
            w.occ[y][x] = nd

        taken = []
        for pid, (sx, sy) in enumerate(self.starts):
            home = self.land_id(sx, sy)
            ring = []
            for y in range(max(0, sy - dmax), min(H, sy + dmax + 1)):
                for x in range(max(0, sx - dmax), min(W, sx + dmax + 1)):
                    d = math.hypot(x - sx, y - sy)
                    if 7 <= d <= dmax and coast(x, y) and self.dstart(x, y) >= d - 0.5:
                        # берег своей суши (острова)
                        if any(self.inb(x + dx, y + dy) and T[y + dy][x + dx] == LAND and
                               self.land_id(x + dx, y + dy) == home for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                            ring.append((d + random.uniform(0, 6), x, y))
            ring.sort()
            schools = []
            for _, x, y in ring:
                if len(schools) >= shore[0]:
                    break
                if any(math.hypot(x - a, y - b) < 7 for a, b in schools + taken):
                    continue
                cells = [(x, y)]
                for _, x2, y2 in sorted((math.hypot(x2 - x, y2 - y), x2, y2) for _, x2, y2 in ring
                                        if 0 < math.hypot(x2 - x, y2 - y) <= 2.3):
                    if len(cells) >= shore[1]:
                        break
                    cells.append((x2, y2))
                if len(cells) < shore[1]:
                    continue
                for cx, cy in cells:
                    if water_free(cx, cy):
                        put('shore_fish', cx, cy)
                schools.append((x, y))
            taken += schools
            # глубоководная: открытая вода подальше от берега, поровну
            deep_c = []
            for y in range(max(0, sy - dmax - 8), min(H, sy + dmax + 9), 1):
                for x in range(max(0, sx - dmax - 8), min(W, sx + dmax + 9), 1):
                    d = math.hypot(x - sx, y - sy)
                    if 12 <= d <= dmax + 8 and open_(x, y) and self.dstart(x, y) >= d - 0.5:
                        deep_c.append((d + random.uniform(0, 10), x, y))
            deep_c.sort()
            got = 0
            for _, x, y in deep_c:
                if got >= deep:
                    break
                if any(math.hypot(x - a, y - b) < 5 for a, b in taken):
                    continue
                put('deep_fish', x, y)
                taken.append((x, y))
                got += 1
        # общие глубоководные рыбы в открытом море
        for _ in range(extra_deep):
            for _ in range(200):
                x, y = random.randrange(3, W - 3), random.randrange(3, H - 3)
                if open_(x, y) and not any(math.hypot(x - a, y - b) < 6 for a, b in taken):
                    put('deep_fish', x, y)
                    taken.append((x, y))
                    break

    # ---------------------------------------------------------------- рельеф и итог
    def relief(self, share, peak=(4, 7), cliffs=(0, 0), no_cliff=0.2, pond_shallows=True):
        w = self.w
        w.gen_opts = dict(hill_share=share, peak=random.randint(*peak), cliffs=random.randint(*cliffs),
                          no_cliff=no_cliff, ponds_shallow=pond_shallows)
        terrain.gen_shallows(w, self.starts)
        terrain.gen_heights(w, self.starts)

    def finish(self, dirt=True):
        w = self.w
        terrain.gen_cliffs(w, self.starts)
        terrain.gen_ground(w, self.starts if dirt else [])       # кочевье: у точки старта земли нет
        paint_roads(w, getattr(self, 'roads', ()))
        w._naval_comps = None
        w._naval_shores = None


def paint_roads(w, cells):
    """Дороги (Black Forest: к союзникам) — земля светлее травы."""
    if not cells:
        return
    g = terrain.G['dirt2']
    for x, y in cells:
        if 0 <= x < w.W and 0 <= y < w.H and w.terrain[y][x] == LAND:
            w.ground[y * w.W + x] = g


# ============================================================ рецепты карт
# Набор игрока Arabia (DE starting_resources.inc, herdable*.inc, lureable.inc): (вид, число, расстояние)
PK_ARABIA = [
    ('gold', 7, 12), ('stone', 5, 16), ('berries', 6, 12),
    ('gold', 4, 22), ('stone', 4, 22), ('gold', 4, 28),
    ('sheep_own', 4, 8),
    ('sheep', 2, 22), ('sheep', 2, 22), ('sheep', 2, 34),
    ('deer', (2, 4), 24, {'spread': 4}), ('deer', (2, 4), 38, {'spread': 2}),
    ('boar', 1, 18), ('boar', 1, 18), ('boar', 1, 36), ('boar', 1, 36),
]


def _arabia(g):
    g.place_starts()
    if random.random() < 0.15:              # DE: пруд в 15 % игр, до 2 маленьких
        for _ in range(random.randint(1, 2)):
            c = g.scatter(lambda x, y: None, 1, 24, 0, edge=14)
            if c:
                g.pond(c[0][0], c[0][1], random.randint(8, 30))
    g.relief(random.uniform(0.11, 0.31), cliffs=(0, 5), no_cliff=0.2)
    g.package(PK_ARABIA[:6])
    g.player_forests((2, 5), (55, 100), (10, 24))
    g.groves(int(round(12 * g.scale)), (40, 80), keep=18)
    g.stragglers()
    g.far_piles('gold', 3, 46)
    g.far_piles('stone', 3, 46)
    g.start_units()
    g.package(PK_ARABIA[6:])
    g.wolves()
    g.relics()
    g.finish()


PK_ARENA = [
    ('gold', 7, 10), ('stone', 5, 10), ('berries', 6, 10), ('gold', 4, 12),
    ('sheep_own', 4, 7), ('sheep', 2, 14), ('sheep', 2, 14),
    ('deer', (3, 4), 13, {'spread': 1.5}), ('boar', 1, 12), ('boar', 1, 12),
]


def _octagon(cx, cy, h, c):
    def inside(x, y):
        dx, dy = abs(x - cx), abs(y - cy)
        return dx <= h and dy <= h and dx + dy <= 2 * h - c
    return inside


def _arena(g):
    w = g.w
    g.place_starts(frac_extra=0.05)
    W, H = g.W, g.H
    h = 19 if g.W < 150 else 20
    regions = [_octagon(sx, sy, h, 3) for sx, sy in g.starts]
    # кольцо стены: клетка внутри, у которой сосед по стороне снаружи (край карты — не стена)
    wall = [[] for _ in range(g.n)]
    owner_of = {}
    for pid, (sx, sy) in enumerate(g.starts):
        ins = regions[pid]
        for y in range(max(1, sy - h), min(H - 1, sy + h + 1)):
            for x in range(max(1, sx - h), min(W - 1, sx + h + 1)):
                if not ins(x, y) or (x, y) in owner_of:
                    continue
                edge = False
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 1 <= nx < W - 1 and 1 <= ny < H - 1 and not ins(nx, ny):
                        edge = True
                if edge:
                    wall[pid].append((x, y))
                    owner_of[(x, y)] = pid
    inside_any = [[any(r(x, y) for r in regions) for x in range(W)] for y in range(H)]
    for (x, y) in owner_of:
        g.setf(x, y, F_WALL)
    # у стены изнутри и снаружи — проход (без леса и куч)
    for (x, y) in owner_of:
        for dy in (-2, -1, 0, 1, 2):
            for dx in (-2, -1, 0, 1, 2):
                if g.inb(x + dx, y + dy):
                    g.setf(x + dx, y + dy, F_CLEAR)
    g.relief(random.uniform(0.06, 0.16), peak=(3, 5), cliffs=(0, 0), no_cliff=1.0)
    # набор игрока — внутри стен
    for item in PK_ARENA[:4]:
        kind, k, d = item[:3]
        for pid in range(g.n):
            g.pile(pid, kind, k, d, spread=2.0, own=2.0, edge=3)
    # лес внутри стены у задней стороны (DE Arena: у каждого свой лес за базой)
    for pid, (sx, sy) in enumerate(g.starts):
        back = g.angs[pid]
        for rel in (-0.9, 0.9):
            a = back + rel
            x, y = int(round(sx + math.cos(a) * (h - 5))), int(round(sy + math.sin(a) * (h - 5)))
            g.forest((x, y), random.randint(45, 70), keep=7)
    # за стенами — сплошной лес; открытый центр
    Rc = g.R * random.uniform(0.9, 1.02)        # открытый центр доходит до стен (DE: поляна-крест)
    ph = [random.uniform(0, math.tau) for _ in range(3)]
    for y in range(H):
        for x in range(W):
            if inside_any[y][x] or g.flag(x, y) & (F_CLEAR | F_WALL):
                continue
            a = math.atan2(y - g.my, x - g.mx)
            r = Rc + 4 * math.sin(g.n * a + ph[0] - g.n * g.angs[0]) + 3 * math.sin(5 * a + ph[1]) + \
                1.5 * math.sin(9 * a + ph[2])
            if math.hypot(x - g.mx, y - g.my) < r:
                continue
            if g.T[y][x] == LAND and w.occ[y][x] is None:
                g.put_node('tree', x, y)
    # дорожки к центру от ворот — не нужны: ворота смотрят в открытый центр
    for pid in range(g.n):
        g.pile(pid, 'gold', 4, h + 7, spread=3, own=0.0, edge=4)
        g.pile(pid, 'stone', 4, h + 7, spread=3, own=0.0, edge=4)
    g.stragglers(k=3)
    g.start_units()
    g.package(PK_ARENA[4:])
    _arena_walls(g, wall)
    g.relics(min_players=h + 6, sep=12)
    g.wolves(per_area=0)
    g.finish()


def _arena_walls(g, wall):
    """Каменные стены (готовые) и ворота 4 клетки на стороне к центру карты."""
    w = g.w
    from . import defense
    for pid, cells in enumerate(wall):
        sx, sy = g.starts[pid]
        fx, fy = math.cos(g.fwd[pid]), math.sin(g.fwd[pid])
        cs = set(cells)
        # ворота: 4 клетки прямой стороны, ближайшие к лучу «вперёд»
        best = None
        for x, y in cells:
            for horiz in (True, False):
                run = [(x + i, y) if horiz else (x, y + i) for i in range(4)]
                if not all(c in cs for c in run):
                    continue
                mx = sum(c[0] for c in run) / 4 - sx
                my = sum(c[1] for c in run) / 4 - sy
                L = math.hypot(mx, my) or 1
                score = (mx * fx + my * fy) / L
                if best is None or score > best[0]:
                    best = (score, run, horiz)
        gate_cells = set(best[1]) if best else set()
        for x, y in cells:
            if (x, y) in gate_cells or w.occ[y][x] is not None:
                continue
            if w.terrain[y][x] != LAND:
                continue
            w.place_building('stone_wall', pid, x, y, complete=True)
        if best:
            run, horiz = best[1], best[2]
            if all(w.occ[y][x] is None and w.terrain[y][x] == LAND for x, y in run):
                w.place_building('gate', pid, run[0][0], run[0][1], complete=True,
                                 size=(4, 1) if horiz else (1, 4))
    w.buildings.sort(key=lambda b: not defense.is_wall(b))     # стены — после центров (порядок отрисовки)


def _black_forest(g):
    w = g.w
    g.place_starts(frac_extra=0.01)
    W, H = g.W, g.H
    rc = max(18.0, min(28.0, math.sqrt(0.30 * W * H / g.n / math.pi)))
    ph = [[random.uniform(0, math.tau) for _ in range(3)] for _ in range(g.n)]
    clear = bytearray(W * H)

    def disc(cx, cy, r, val=1):
        for y in range(max(0, int(cy - r - 1)), min(H, int(cy + r + 2))):
            for x in range(max(0, int(cx - r - 1)), min(W, int(cx + r + 2))):
                if math.hypot(x - cx, y - cy) <= r:
                    clear[y * W + x] = val

    for pid, (sx, sy) in enumerate(g.starts):
        p = ph[pid]
        for y in range(max(0, int(sy - rc - 5)), min(H, int(sy + rc + 6))):
            for x in range(max(0, int(sx - rc - 5)), min(W, int(sx + rc + 6))):
                a = math.atan2(y - sy, x - sx)
                r = rc + 2.5 * math.sin(3 * a + p[0]) + 1.6 * math.sin(5 * a + p[1]) + 1.0 * math.sin(7 * a + p[2])
                if math.hypot(x - sx, y - sy) <= r:
                    clear[y * W + x] = 1
    # центр: поляна (+ пруд в половине игр)
    disc(g.mx, g.my, 9 + g.n * 0.7)
    roads = []

    def lane(a, b, width, road=False):
        (x0, y0), (x1, y1) = a, b
        L = max(1, int(math.hypot(x1 - x0, y1 - y0)))
        wob = random.uniform(0, math.tau)
        for i in range(L + 1):
            t = i / L
            off = math.sin(t * math.pi) * 4 * math.sin(wob + t * 5)
            nx, ny = -(y1 - y0) / L, (x1 - x0) / L
            cx = x0 + (x1 - x0) * t + nx * off
            cy = y0 + (y1 - y0) * t + ny * off
            disc(cx, cy, width / 2)
            if road:
                roads.append((int(round(cx)), int(round(cy))))

    for pid, s in enumerate(g.starts):          # просека 3 клетки от каждого к центру
        lane(s, (g.mx, g.my), 4.2)
    for i in range(g.n):                        # дороги к союзникам-соседям
        for j in range(i + 1, g.n):
            if w.players[i].team == w.players[j].team:
                lane(g.starts[i], g.starts[j], 3.2, road=True)
    g.roads = roads
    if random.random() < 0.5:
        g.pond(int(g.mx), int(g.my), 32)
    g.relief(random.uniform(0.18, 0.3), peak=(5, 7), cliffs=(0, 1), no_cliff=0.6)
    # набор игрока — на поляне
    for kind, k, d in (('gold', 7, 12), ('stone', 5, 14), ('berries', 6, 12), ('gold', 4, 16),
                       ('stone', 4, 20), ('gold', 4, 21)):
        for pid in range(g.n):
            g.pile(pid, kind, k, d, spread=2.0)
    g.stragglers()
    # всё, что не поляна и не просека, — лес
    for y in range(H):
        for x in range(W):
            if clear[y * W + x] or g.T[y][x] != LAND or w.occ[y][x] is not None:
                continue
            if g.flag(x, y) & (F_CLEAR | F_RES):
                continue
            if g.near_flag(x, y, 1, F_RES):
                continue
            g.put_node('tree', x, y)
    # на полянах — пара «островков» леса у игрока (DE: player forests в поляне)
    g.player_forests((1, 2), (25, 45), (12, rc - 2), keep=9)
    # дальние кучи @36 — в лесных карманах (лес вокруг вырубается)
    for kind, k in (('gold', 4), ('stone', 4)):
        for pid in range(g.n):
            _pocket_pile(g, pid, kind, k, 36)
    g.start_units()
    g.package([('sheep_own', 4, 8), ('sheep', 2, 16), ('sheep', 2, 18), ('deer', (3, 4), 19, {'spread': 3}),
               ('boar', 1, 16), ('boar', 1, 17)])
    for pid in range(g.n):
        _pocket_herd(g, pid, 'boar', 38)
    g.wolves(min_players=38, per_area=3)
    g.relics(min_players=24, sep=16, open_r=0)
    g.finish()


def _clear_trees(g, cx, cy, r):
    w = g.w
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if g.inb(x, y) and math.hypot(x - cx, y - cy) <= r + 0.3:
                o = w.occ[y][x]
                if isinstance(o, Node) and o.kind == 'tree':
                    w.occ[y][x] = None
                    o.alive = False
                    g.flags[y * g.W + x] &= ~F_FOREST
    w.nodes = [n for n in w.nodes if n.alive]


def _dig(g, x, y, tx, ty):
    """Тропа шириной ≈ 2 от кармана к старту — до первой клетки поляны (без деревьев вокруг)."""
    L = max(1, int(math.hypot(tx - x, ty - y)))
    for i in range(4, L):
        cx = int(round(x + (tx - x) * i / L))
        cy = int(round(y + (ty - y) * i / L))
        if not g.near_flag(cx, cy, 2, F_FOREST):
            break
        _clear_trees(g, cx, cy, 1)


def _pocket_pile(g, pid, kind, k, d):
    """Куча в лесу: карман радиусом 3 вокруг неё, соединённый с ближайшей поляной короткой просекой."""
    sx, sy = g.starts[pid]
    for _ in range(80):
        a = random.uniform(0, math.tau)
        x, y = int(round(sx + math.cos(a) * d)), int(round(sy + math.sin(a) * d))
        if not g.inb(x, y, 5) or g.T[y][x] != LAND:
            continue
        if any(math.hypot(x - ox, y - oy) < d + 2 for q, (ox, oy) in enumerate(g.starts) if q != pid):
            continue
        if g.near_flag(x, y, 5, F_RES):
            continue
        _clear_trees(g, x, y, 3)
        cells = g.tight(x, y, k, lambda a2, b2: g.res_ok(a2, b2, 0, 0))
        if cells:
            for cx, cy in cells:
                g.put_node(kind, cx, cy)
            _dig(g, x, y, sx, sy)
            return cells
    return None


def _pocket_herd(g, pid, kind, d):
    sx, sy = g.starts[pid]
    for _ in range(60):
        a = random.uniform(0, math.tau)
        x, y = int(round(sx + math.cos(a) * d)), int(round(sy + math.sin(a) * d))
        if not g.inb(x, y, 4) or g.T[y][x] != LAND:
            continue
        if any(math.hypot(x - ox, y - oy) < d for q, (ox, oy) in enumerate(g.starts) if q != pid):
            continue
        _clear_trees(g, x, y, 2)
        _dig(g, x, y, sx, sy)
        if g.free_land(x, y):
            g.animal(kind, x, y)
            return (x, y)
    return None


def _nomad(g):
    w = g.w
    W, H = g.W, g.H
    # вода по краю карты (DE nomad: 25–40 % карты), суша в центре; игроки ближе к воде
    E = W * random.uniform(0.075, 0.1)
    ph = [random.uniform(0, math.tau) for _ in range(4)]
    for y in range(H):
        for x in range(W):
            e = min(x, y, W - 1 - x, H - 1 - y)
            a = math.atan2(y - (H - 1) / 2, x - (W - 1) / 2)
            wob = 3.5 * math.sin(4 * a + ph[0]) + 2.5 * math.sin(7 * a + ph[1]) + 1.5 * math.sin(11 * a + ph[2])
            if e < E + wob:
                g.T[y][x] = WATER
    g.place_starts(frac_extra=0.0)
    for sx, sy in g.starts:                  # у кочевья старт не у самой воды
        for y in range(sy - 7, sy + 8):
            for x in range(sx - 7, sx + 8):
                if g.inb(x, y, 1) and math.hypot(x - sx, y - sy) < 7.5:
                    g.T[y][x] = LAND
    g.label_land()
    if random.random() < 0.5:                # пруд в половине игр
        g.pond(int(g.mx), int(g.my), int(0.04 * W * H / 4))
    g.label_land()
    g.relief(random.uniform(0.12, 0.25), cliffs=(0, 2), no_cliff=0.5)
    # ресурсы — вокруг точки игрока, но дальше, чем обычно (центра нет: сам выбираешь место)
    for kind, k, d in (('gold', 7, 15), ('stone', 5, 18), ('berries', 6, 14), ('gold', 4, 24), ('stone', 4, 26),
                       ('gold', 4, 30)):
        for pid in range(g.n):
            g.pile(pid, kind, k, d, spread=3.0)
    g.player_forests((3, 4), (50, 90), (9, 26), keep=6)
    g.groves(int(round(10 * g.scale)), (35, 70), keep=16)
    g.stragglers(k=3, dmin=4, dmax=8)
    g.start_units(tc=False)
    g.package([('sheep', 4, 10), ('sheep', 2, 20), ('sheep', 2, 26), ('deer', (3, 4), 22, {'spread': 3}),
               ('boar', 1, 18), ('boar', 1, 20)])
    g.fish(shore=(3, 3), deep=3, dmax=38, extra_deep=int(10 * g.scale))
    g.wolves(per_area=2)
    g.relics(min_players=26, sep=18)
    g.finish(dirt=False)
    for p in w.players:                      # на центр: дерева как в DE (275 сверху)
        p.res['wood'] += 275


def _islands(g):
    W, H = g.W, g.H
    n = g.n
    area = 0.40 * W * H / n                  # суша игроков — 35 % карты (+ кромка, срезанная краем)
    r0 = math.sqrt(area / math.pi)
    # пролив между островами ≥ 7 клеток
    R = circle_radius(W, 0.01)
    chord = 2 * R * math.sin(math.pi / n) if n > 1 else W
    r0 = min(r0 * 1.08, (chord - 8) / 2 / 1.18)
    R = min(R, W / 2 - r0 * 0.6 - 3)             # остров может упираться в край карты (кромка воды 3)
    for y in range(H):
        for x in range(W):
            g.T[y][x] = WATER
    g.place_starts(radius=R, jitter=0.3)
    for pid, (sx, sy) in enumerate(g.starts):
        p = [random.uniform(0, math.tau) for _ in range(3)]
        for y in range(max(0, int(sy - r0 * 1.3)), min(H, int(sy + r0 * 1.3) + 1)):
            for x in range(max(0, int(sx - r0 * 1.3)), min(W, int(sx + r0 * 1.3) + 1)):
                a = math.atan2(y - sy, x - sx)
                r = r0 * (1 + 0.1 * math.sin(3 * a + p[0]) + 0.06 * math.sin(5 * a + p[1]))
                if math.hypot(x - sx, y - sy) < r and min(x, y, W - 1 - x, H - 1 - y) >= 3:
                    g.T[y][x] = LAND
    _smooth(g)
    # нейтральные островки с золотом и камнем (DE: 1–2 % карты)
    small = []
    for i in range(max(3, n + 1 + int(g.scale))):
        for _ in range(200):
            x, y = random.randrange(8, W - 8), random.randrange(8, H - 8)
            if any(g.T[yy][xx] != WATER for yy in range(y - 8, y + 9) for xx in range(x - 8, x + 9)
                   if g.inb(xx, yy)):
                continue
            if any(math.hypot(x - a, y - b) < 16 for a, b in small):
                continue
            cells = g.blob((x, y), random.randint(70, 140), lambda a, b: _isle_ok(g, a, b, r0), aspect=(1.0, 2.2))
            for a, b in cells:
                g.T[b][a] = LAND
            small.append((x, y))
            break
    g.label_land()
    g.relief(random.uniform(0.08, 0.16), peak=(3, 5), cliffs=(0, 0), no_cliff=1.0)
    for kind, k, d in (('gold', 7, 12), ('stone', 4, 14), ('berries', 6, 11), ('gold', 4, 13), ('stone', 3, 17),
                       ('gold', 3, 19), ('stone', 3, 19)):
        for pid in range(n):
            g.pile(pid, kind, k, d, spread=2.5, own=None)
    # лес: 450 клеток на остров в 9 рощах (×площадь острова / эталон 100²·35 %/2)
    k_isl = area / (0.35 * 10000 / 2)
    per = max(20, int(450 * min(1.6, k_isl) / 9))
    for pid in range(n):
        for _ in range(9):
            c = g.spot(pid, 9, r0 * 0.95, lambda x, y: g.forest_ok(x, y, 8) and
                       not g.near_flag(x, y, 2, F_RES | F_FOREST), own=None, edge=3, tries=80)
            if c:
                g.forest(c, per, keep=8)
    g.stragglers()
    for x, y in small:
        kind = random.choice(('gold', 'gold', 'stone'))
        cells = g.tight(x, y, random.randint(5, 10), lambda a, b: g.res_ok(a, b, 0, 0))
        for a, b in cells or ():
            g.put_node(kind, a, b)
        g.forest((x + 3, y + 3), 12, keep=None)
    g.start_units()
    g.package([('sheep_own', 4, 8), ('sheep', 2, 14), ('sheep', 2, 16), ('deer', (3, 4), 16, {'spread': 3})])
    g.fish(shore=(3, 3), deep=4, dmax=34, extra_deep=int(12 * g.scale))
    ok = (lambda x, y: g.free_land(x, y) and not g.flag(x, y) & (F_FOREST | F_RES))
    _relics_any(g, ok)
    g.finish()


def _isle_ok(g, a, b, r0):
    """Клетка нейтрального островка: вода вдали от островов игроков (пролив ≥ 5 клеток)."""
    if not g.inb(a, b, 4) or g.T[b][a] != WATER:
        return False
    if min(math.hypot(a - sx, b - sy) for sx, sy in g.starts) < r0 * 1.25 + 6:
        return False
    return True


def _relics_any(g, ok):
    """Реликвии на островах: сначала нейтральные островки, затем дальние стороны островов игроков."""
    try:
        from . import relics
    except ImportError:
        return
    k = _by_size(RELICS, g.W)

    def put(x, y):
        relics.spawn(g.w, x, y)
        g.setf(x, y, F_RES)

    got = g.scatter(put, k, 16, 14, ok=ok, edge=4)
    if len(got) < k:
        g.scatter(put, k - len(got), 10, 8, ok=ok, edge=3)


def _smooth(g):
    T = g.T
    W, H = g.W, g.H
    for _ in range(2):
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                s = sum(1 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if T[y + dy][x + dx] == WATER)
                if T[y][x] == WATER and s <= 1:
                    T[y][x] = LAND
                elif T[y][x] == LAND and s >= 3:
                    T[y][x] = WATER


def _mediterranean(g):
    W, H = g.W, g.H
    g.place_starts(frac_extra=0.0)
    # море: 80 % внутренней области (кромка ≈ 14 % стороны), от стартов — не ближе 12 клеток
    half = W / 2 - W * 0.14
    ph = [random.uniform(0, math.tau) for _ in range(5)]
    amp = [random.uniform(0.04, 0.09), random.uniform(0.03, 0.06), random.uniform(0.01, 0.03)]
    for y in range(H):
        for x in range(W):
            dx, dy = abs(x - g.mx) / half, abs(y - g.my) / half
            rr = (dx ** 3 + dy ** 3) ** (1 / 3)            # скруглённый квадрат (море повторяет форму карты)
            a = math.atan2(y - g.my, x - g.mx)
            lim = 1.0 - amp[0] * (1 + math.sin(3 * a + ph[0])) - amp[1] * (1 + math.sin(5 * a + ph[1])) - \
                amp[2] * (1 + math.sin(11 * a + ph[2]))
            if rr < lim and g.dstart(x, y) > 12 + 1.5 * math.sin(4 * a + ph[3]):
                g.T[y][x] = WATER
    _smooth(g)
    g.label_land()
    g.relief(random.uniform(0.1, 0.2), cliffs=(0, 2), no_cliff=0.5)
    g.package(PK_ARABIA[:6])
    # лес: 9 % суши в 12 рощах + леса игроков поменьше
    g.player_forests((2, 3), (45, 80), (9, 20))
    land = sum(row.count(LAND) for row in g.T)
    k = int(round(12 * g.scale))
    g.groves(k, (max(20, int(0.09 * land / k * 0.6)), max(30, int(0.09 * land / k * 1.2))), keep=15)
    g.stragglers()
    g.start_units()
    g.package([('sheep_own', 4, 8), ('sheep', 2, 20), ('sheep', 2, 22), ('sheep', 3, 35), ('sheep', 3, 35),
               ('deer', (3, 4), 22, {'spread': 4}), ('boar', 1, 18), ('boar', 1, 18)])
    g.fish(shore=(2, 3), deep=4, dmax=34, extra_deep=int(8 * g.scale))
    g.wolves(per_area=2, min_players=28)
    g.relics(min_players=26, sep=16)
    g.finish()


def _theme(w, mt):
    """Пейзаж: Arabia — 1 из пула (как 11 биомов DE), у остальных — свой."""
    forced = w.settings.get('theme') if hasattr(w, 'settings') else None
    try:
        from . import themes
    except ImportError:
        return 'grass'
    if forced and forced in themes.THEMES:
        return forced
    if mt == 'arabia':
        return random.choice(themes.ARABIA_POOL)
    return {'arena': 'grass', 'black_forest': 'grass', 'nomad': 'grass', 'islands': 'tropical',
            'mediterranean': 'grass'}.get(mt, 'grass')


RECIPES = {'arabia': _arabia, 'arena': _arena, 'black_forest': _black_forest, 'nomad': _nomad,
           'islands': _islands, 'mediterranean': _mediterranean}


def generate(w):
    """Сгенерировать карту w.map_type (из RECIPES) в пустом мире w."""
    g = Gen(w)
    w.theme = _theme(w, w.map_type)
    RECIPES.get(w.map_type, _arabia)(g)
    if maps.is_nomad(w.map_type):
        w.nomad = True
    return g
