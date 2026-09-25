"""Вода: типы карт, морская проходимость и поиск пути, корабли, транспорт, рыба, доки.

Морской домен проходимости отдельный от сухопутного (World.passable / World.find_path не трогаются):
  water_ok(w, x, y)        — клетка воды, свободная (или занятая доком — в док корабли заходят);
  find_path_water(...)     — A* только по воде (как World.find_path, но свой домен);
  nearest_water_tile(...)  — ближайшая водная клетка (опционально — в той же акватории);
  comps(w)                 — компоненты связности суши и воды (карта статична, считается один раз);
  shores(w)                — пары (клетка суши, соседняя клетка воды) с номерами компонент — берег.
Корабли — класс Ship(Unit): тот же набор приказов, но движение, поиск цели, рыбалка и выгрузка — по воде.
Сухопутные юниты в воду не заходят никогда; через воду их возит транспорт (order_board / Ship.cmd_unload).
Типы карт: MAP_TYPES — 'land' (материк с озёрами), 'coast' (море в центре), 'islands' (острова команд).
"""
import heapq
import math
import random

from .data import TILE, DIRS, BUILDINGS, NODE_DEFS
from .world import Unit, Building, Node, Projectile
from . import maps

MAP_TYPES = maps.ALL           # список карт — game/maps.py (новые по правилам DE + старые land/coast)
MAP_NAMES = maps.NAMES
FISH = tuple(k for k, d in NODE_DEFS.items() if d.get('water'))


# ============================================================ домен воды
def water_ok(w, x, y):
    if not (0 <= x < w.W and 0 <= y < w.H) or w.terrain[y][x] != 1:
        return False
    o = w.occ[y][x]
    return o is None or (isinstance(o, Building) and o.d.get('water', False))


def water_free(w, x, y):
    """Вода без всего (для появления и высадки кораблей)."""
    return 0 <= x < w.W and 0 <= y < w.H and w.terrain[y][x] == 1 and w.occ[y][x] is None


def water_px(w, x, y):
    return water_ok(w, int(x // TILE), int(y // TILE))


def comps(w):
    """(lc, wc, wsize): номера компонент суши / воды для каждой клетки (-1 — не тот тип), размеры акваторий."""
    c = getattr(w, '_naval_comps', None)
    if c is None:
        c = w._naval_comps = _compute_comps(w)
    return c


def _compute_comps(w):
    W, H = w.W, w.H
    lc = [-1] * (W * H)
    wc = [-1] * (W * H)
    wsize = {}
    n_l = n_w = 0
    for s in range(W * H):
        if lc[s] >= 0 or wc[s] >= 0:
            continue
        x, y = s % W, s // W
        water = w.terrain[y][x] == 1
        arr = wc if water else lc
        cid = n_w if water else n_l
        arr[s] = cid
        stack = [s]
        cnt = 0
        while stack:
            c = stack.pop()
            cnt += 1
            cx, cy = c % W, c // W
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < W and 0 <= ny < H:
                    nc = ny * W + nx
                    if arr[nc] < 0 and (w.terrain[ny][nx] == 1) == water:
                        arr[nc] = cid
                        stack.append(nc)
        if water:
            wsize[cid] = cnt
            n_w += 1
        else:
            n_l += 1
    return lc, wc, wsize


def land_comp(w, tx, ty):
    if 0 <= tx < w.W and 0 <= ty < w.H:
        return comps(w)[0][ty * w.W + tx]
    return -1


def water_comp(w, tx, ty):
    if 0 <= tx < w.W and 0 <= ty < w.H:
        return comps(w)[1][ty * w.W + tx]
    return -1


def same_land(w, a, b):
    la = land_comp(w, *a)
    return la >= 0 and la == land_comp(w, *b)


def shores(w):
    """Список (лx, лy, вx, вy, компонента суши, компонента воды): суша, соседняя (по стороне) с водой."""
    s = getattr(w, '_naval_shores', None)
    if s is None:
        lc, wc, _ = comps(w)
        W = w.W
        s = []
        for y in range(w.H):
            for x in range(W):
                if w.terrain[y][x] != 0:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < w.H and w.terrain[ny][nx] == 1:
                        s.append((x, y, nx, ny, lc[y * W + x], wc[ny * W + nx]))
        w._naval_shores = s
    return s


def ship_comp(w, s):
    tx, ty = s.tile()
    c = water_comp(w, tx, ty)
    if c < 0:   # на краю дока / берега — берём соседнюю воду
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            c = water_comp(w, tx + dx, ty + dy)
            if c >= 0:
                break
    return c


def nearest_water_tile(w, tx, ty, maxr=16, comp=None, free=False):
    ok = water_free if free else water_ok

    def good(x, y):
        return ok(w, x, y) and (comp is None or water_comp(w, x, y) == comp)

    if good(tx, ty):
        return tx, ty
    for r in range(1, maxr):
        best, bd = None, 1e9
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if max(abs(dx), abs(dy)) == r and good(tx + dx, ty + dy):
                    d = dx * dx + dy * dy
                    if d < bd:
                        bd, best = d, (tx + dx, ty + dy)
        if best:
            return best
    return tx, ty


def find_path_water(w, start, goals, hx, hy, limit=4000):
    """A* по воде (8 направлений, без срезания углов о сушу). Если цели не достичь —
    путь к ближайшей по эвристике достигнутой клетке (как World.find_path)."""
    W, H = w.W, w.H
    sx, sy = start
    s = sy * W + sx
    gset = {y * W + x for x, y in goals}
    if s in gset:
        return []
    terr, occ = w.terrain, w.occ

    def ok(x, y):
        if not (0 <= x < W and 0 <= y < H) or terr[y][x] != 1:
            return False
        o = occ[y][x]
        return o is None or (isinstance(o, Building) and o.d.get('water', False))

    openh = [(0.0, 0.0, s)]
    g = {s: 0.0}
    came = {s: -1}
    best, besth = s, 1e9
    n = 0
    while openh and n < limit:
        f, gc, c = heapq.heappop(openh)
        if gc > g[c]:
            continue
        n += 1
        if c in gset:
            best = c
            break
        x, y = c % W, c // W
        ex, ey = abs(x - hx), abs(y - hy)
        h = max(ex, ey) + 0.414 * min(ex, ey)
        if h < besth:
            besth, best = h, c
        # прямые соседи считаем один раз; диагональ — только если открыты обе прилегающие прямые
        e, wv, so, no = ok(x + 1, y), ok(x - 1, y), ok(x, y + 1), ok(x, y - 1)
        orth = {(1, 0): e, (-1, 0): wv, (0, 1): so, (0, -1): no}
        for ddx, ddy, cost in DIRS:
            if ddx and ddy:
                if not (orth[ddx, 0] and orth[0, ddy]) or not ok(x + ddx, y + ddy):
                    continue
            elif not orth[ddx, ddy]:
                continue
            nx, ny = x + ddx, y + ddy
            nc = ny * W + nx
            ng = gc + cost
            if ng < g.get(nc, 1e18):
                g[nc] = ng
                came[nc] = c
                ex, ey = abs(nx - hx), abs(ny - hy)
                heapq.heappush(openh, (ng + max(ex, ey) + 0.414 * min(ex, ey), ng, nc))
    path = []
    c = best
    while c != s and c != -1:
        path.append((c % W, c // W))
        c = came[c]
    path.reverse()
    return path


def path_to_entity_water(w, u, e, rng=None):
    """Путь корабля к сущности: цели — клетки своей акватории, откуда e в пределах rng клеток
    (по умолчанию — вплотную). Если таких нет — пустой путь (цель недосягаема с воды)."""
    comp = ship_comp(w, u)
    if isinstance(e, Unit):
        cx, cy = e.x / TILE, e.y / TILE
        rx0, ry0, rx1, ry1 = cx, cy, cx, cy
    else:
        rx0, ry0, rx1, ry1 = e.tx, e.ty, e.tx + e.w, e.ty + e.h
    r = max(1.2, (rng or 0) + 0.3)
    R = int(math.ceil(r))
    goals = []
    for y in range(int(ry0) - R, int(ry1) + R + 1):
        for x in range(int(rx0) - R, int(rx1) + R + 1):
            if water_ok(w, x, y) and water_comp(w, x, y) == comp:
                dx = max(rx0 - (x + 0.5), 0, (x + 0.5) - rx1)
                dy = max(ry0 - (y + 0.5), 0, (y + 0.5) - ry1)
                if dx * dx + dy * dy <= r * r:
                    goals.append((x, y))
    if not goals:
        return []
    hx, hy = int((rx0 + rx1) / 2), int((ry0 + ry1) / 2)
    return find_path_water(w, u.tile(), goals, hx, hy, limit=3000)


def can_reach(w, s, t, extra=1.0):
    """Может ли корабль s подойти на дистанцию атаки к t: есть ли вода его акватории в пределах досягаемости."""
    comp = ship_comp(w, s)
    r = (s.rng_tiles() if s.d['rng'] > 0 else 0.6) + extra
    if isinstance(t, Unit):
        cx, cy = t.x / TILE, t.y / TILE
        rx0, ry0, rx1, ry1 = cx, cy, cx, cy
    else:
        rx0, ry0, rx1, ry1 = t.tx, t.ty, t.tx + t.w, t.ty + t.h
    R = int(math.ceil(r))
    for y in range(int(ry0) - R, int(ry1) + R + 1):
        for x in range(int(rx0) - R, int(rx1) + R + 1):
            if water_ok(w, x, y) and water_comp(w, x, y) == comp:
                dx = max(rx0 - (x + 0.5), 0, (x + 0.5) - rx1)
                dy = max(ry0 - (y + 0.5), 0, (y + 0.5) - ry1)
                if dx * dx + dy * dy <= r * r:
                    return True
    return False


# ============================================================ здания на воде
def can_place_water(w, kind, tx, ty, pid, check_explored=True):
    """Док: все клетки — свободная вода, и хотя бы одна клетка по стороне от него — суша."""
    s = BUILDINGS[kind]['size']
    for y in range(ty, ty + s):
        for x in range(tx, tx + s):
            if not (0 <= x < w.W and 0 <= y < w.H):
                return False
            if w.terrain[y][x] != 1 or w.occ[y][x] is not None or w.floor[y][x] is not None:
                return False
            if pid == w.human and check_explored and not w.explored[y * w.W + x]:
                return False
    ring = [(x, ty - 1) for x in range(tx, tx + s)] + [(x, ty + s) for x in range(tx, tx + s)] + \
           [(tx - 1, y) for y in range(ty, ty + s)] + [(tx + s, y) for y in range(ty, ty + s)]
    inb = [(x, y) for x, y in ring if 0 <= x < w.W and 0 <= y < w.H]
    if not any(w.terrain[y][x] == 0 for x, y in inb):
        return False
    if not any(w.terrain[y][x] == 1 for x, y in inb):
        return False
    for u in w.units:
        if u.owner != pid and tx * TILE - 4 <= u.x <= (tx + s) * TILE + 4 and ty * TILE - 4 <= u.y <= (ty + s) * TILE + 4:
            return False
    return True


def dock_land(w, tx, ty, s):
    """Сторона дока (dx, dy), где больше всего суши вдоль основания: туда смотрит «дом» спрайта."""
    best, bn = (-1, 0), -1
    for d, cells in (((0, -1), [(x, ty - 1) for x in range(tx, tx + s)]),
                     ((-1, 0), [(tx - 1, y) for y in range(ty, ty + s)]),
                     ((0, 1), [(x, ty + s) for x in range(tx, tx + s)]),
                     ((1, 0), [(tx + s, y) for y in range(ty, ty + s)])):
        n = sum(1 for x, y in cells if 0 <= x < w.W and 0 <= y < w.H and w.terrain[y][x] != 1)
        if n > bn:
            best, bn = d, n
    return best


def dock_comp(w, b):
    for y in range(b.ty - 1, b.ty + b.h + 1):
        for x in range(b.tx - 1, b.tx + b.w + 1):
            c = water_comp(w, x, y)
            if c >= 0:
                return c
    return -1


def nearest_dock(w, s):
    comp = ship_comp(w, s)
    best, bd = None, 1e18
    for b in w.buildings:
        if b.owner == s.owner and b.alive and b.complete and b.d.get('water') and 'food' in b.d.get('drop', ()):
            if dock_comp(w, b) != comp:
                continue
            d = s.dist_to(b)
            if d < bd:
                bd, best = d, b
    return best


def spawn_ship(w, b, kind):
    comp = None
    cand = []
    for y in range(b.ty - 1, b.ty + b.h + 1):
        for x in range(b.tx - 1, b.tx + b.w + 1):
            if not (b.tx <= x < b.tx + b.w and b.ty <= y < b.ty + b.h) and water_free(w, x, y):
                # к открытой воде (побольше акватория), затем «снизу», как у зданий на суше
                cand.append((-comps(w)[2].get(water_comp(w, x, y), 0), -(y - b.ty) * 2 - (x - b.tx), x, y))
    if cand:
        cand.sort()
        _, _, tx, ty = cand[0]
    else:
        tx, ty = nearest_water_tile(w, b.tx + b.w // 2, b.ty + b.h // 2, comp=comp, free=True)
    s = Ship(kind, b.owner, (tx + 0.5) * TILE + random.uniform(-3, 3), (ty + 0.5) * TILE + random.uniform(-3, 3), w)
    w.units.append(s)
    r = b.rally
    if r is not None:
        if isinstance(r, tuple):
            s.cmd_move(*r)
        elif r.alive:
            if isinstance(r, Node) and r.kind in FISH and s.d.get('fisher'):
                s.cmd_gather(r)
            elif w.hostile(r.owner, s.owner):
                s.cmd_attack(r)
            else:
                s.cmd_move(*r.center())
    return s


# ============================================================ поиск рыбы
def fish_reachable(w, n, comp):
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if (dx or dy) and water_free(w, n.tx + dx, n.ty + dy) and water_comp(w, n.tx + dx, n.ty + dy) == comp:
                return True
    return False


def find_fish(w, s, x, y, radius):
    comp = ship_comp(w, s)
    best, bd = None, radius * TILE
    for n in w.nodes:
        if not n.alive or n.kind not in FISH:
            continue
        cx, cy = n.center()
        d = math.hypot(cx - x, cy - y)
        if d < bd and fish_reachable(w, n, comp):
            bd, best = d, n
    return best


# ============================================================ корабль
class Ship(Unit):
    naval = True

    def __init__(self, kind, owner, x, y, world):
        super().__init__(kind, owner, x, y, world)
        self.w = world
        self.cargo = []             # пассажиры транспорта (вне World.units, alive=False, aboard=корабль)
        self.to_load = []           # кого ждём на посадку
        self.load_t = 0.0
        self.unload_pt = None
        self.landing = None
        self.ignore = {}            # id цели → до какого времени её не трогать (недосягаема с воды)
        self.prog = (0.0, 1e18)     # замер продвижения к цели: (время, дистанция)

    # ---- характеристики
    def capacity(self):
        return self.p.stat('carry', self.kind, self.d.get('carry', 15))

    def cargo_cap(self):
        return int(self.p.stat('cargo', self.kind, self.d.get('cargo', 0)))

    def release(self):
        Unit.release(self)
        if not self.alive and self.cargo:
            # транспорт затонул — пассажиры гибнут
            for c in self.cargo:
                c.aboard = None
                c.alive = False
                self.w.emit('death', self.x, self.y, c.owner, c.kind)
            self.cargo = []

    # ---- приказы
    def cmd_gather(self, t):
        if not self.d.get('fisher') or not isinstance(t, Node) or t.kind not in FISH:
            self.cmd_move(*t.center())
            return
        self.release()
        self.state = 'gather'
        self.target = t
        self.gather_kind = t.kind
        self.path_target = None

    def cmd_build(self, b):
        pass

    def cmd_unload(self, x, y):
        """Плыть к берегу у точки (x, y) и высадить пассажиров."""
        self.release()
        self.state = 'unload'
        self.target = None
        self.unload_pt = (x, y)
        self.landing = None
        self.path = []
        self.pending = None

    def cmd_attack(self, t):
        if t is None or self.d['atk'] <= 0:
            return
        Unit.cmd_attack(self, t)
        self.prog = (self.w.time, 1e18)

    # ---- движение (только вода)
    def step_toward(self, w, px, py, dt):
        dx, dy = px - self.x, py - self.y
        d = math.hypot(dx, dy)
        if d < 0.5:
            return
        s = min(self.speed() * dt, d)
        nx, ny = self.x + dx / d * s, self.y + dy / d * s
        if water_px(w, nx, ny):
            self.x, self.y = nx, ny
        elif water_px(w, nx, self.y):
            self.x = nx
        elif water_px(w, self.x, ny):
            self.y = ny
        self.face = (dx / d, dy / d)
        self.anim += dt * 12

    def do_move(self, w, dt):
        if self.pending is not None:
            if w.path_budget <= 0:
                return
            w.path_budget -= 1
            x, y = self.pending
            self.pending = None
            gx, gy = int(x // TILE), int(y // TILE)
            comp = ship_comp(w, self)
            if water_ok(w, gx, gy) and water_comp(w, gx, gy) == comp:
                goal = (gx, gy)
            else:
                goal = nearest_water_tile(w, gx, gy, comp=comp)
            self.path = find_path_water(w, self.tile(), [goal], goal[0], goal[1])
            reached = (self.path and self.path[-1] == goal) or self.tile() == goal
            self.dest = (x, y) if reached and goal == (gx, gy) else None
        if self.walk_path(w, dt):
            self.state = 'idle'

    def approach(self, w, ent, rng, dt):
        if self.dist_to(ent) <= rng:
            self.path = []
            return True
        if isinstance(ent, Unit) and math.hypot(ent.x - self.x, ent.y - self.y) < 2.0 * TILE:
            self.path = []
            self.step_toward(w, ent.x, ent.y, dt)
            return False
        need = self.path_target is not ent or (w.time >= self.repath_t and (not self.path or isinstance(ent, Unit)))
        if need and w.path_budget > 0:
            w.path_budget -= 1
            self.repath_t = w.time + (1.5 if isinstance(ent, Unit) else 3.0) + random.random() * 0.5
            self.path_target = ent
            self.path = path_to_entity_water(w, self, ent, rng / TILE)
            self.dest = None
        if self.path:
            self.dest = None
            self.walk_path(w, dt)
        else:
            cx, cy = ent.center()
            self.step_toward(w, cx, cy, dt)
        return False

    # ---- обновление
    def update(self, w, dt):
        if self.to_load:
            self.load_tick(w)
        st = self.state
        if st == 'idle':
            self.cool = max(0.0, self.cool - dt)
            self.swing = max(0.0, self.swing - dt)
            if self.d['atk'] > 0 and w.time >= self.scan_t:
                self.scan_t = w.time + 0.6
                e = self.find_target(w, self.los() * TILE, buildings=bool(self.d.get('siege')))
                if e is not None:
                    self.cmd_attack(e)
            return
        if st == 'unload':
            self.do_unload(w, dt)
            return
        Unit.update(self, w, dt)

    def find_target(self, w, radius, buildings=True):
        hrow = w.hmat[self.owner]
        fogged = self.owner == w.human
        now = w.time
        best, bd = None, radius
        if not self.d.get('siege'):
            for o in w.units:
                if not hrow[o.owner] or not o.alive or self.ignore.get(id(o), 0) > now:
                    continue
                if abs(o.x - self.x) + abs(o.y - self.y) > bd * 1.5:
                    continue
                if fogged and not w.visible_px(o.x, o.y):
                    continue
                d = math.hypot(o.x - self.x, o.y - self.y)
                if d < bd and (o.naval or can_reach(w, self, o)):
                    bd, best = d, o
            if best is not None:
                return best
        if buildings:
            bd = radius
            for b in w.buildings:
                if not hrow[b.owner] or not b.alive or b.kind == 'farm' or self.ignore.get(id(b), 0) > now:
                    continue
                if fogged and not b.seen:
                    continue
                d = self.dist_to(b)
                if d < bd and can_reach(w, self, b):
                    bd, best = d, b
        return best

    def give_up(self, w, t):
        self.ignore[id(t)] = w.time + 25
        if len(self.ignore) > 40:
            self.ignore = {k: v for k, v in self.ignore.items() if v > w.time}
        self.target = None
        self.path = []
        self.state = 'idle'

    def do_attack(self, w, dt):
        t = self.target
        if t is None or not t.alive or getattr(t, 'dead', False) or isinstance(t, Node):
            self.target = None
            e = self.find_target(w, self.los() * TILE, buildings=True)
            if e is not None:
                self.cmd_attack(e)
            else:
                self.state = 'idle'
            return
        d = self.dist_to(t)
        # продвигаемся ли к цели? раз в 3 с: если нет и цель вне досягаемости с воды — бросаем
        pt, pd = self.prog
        if w.time - pt > 3.0:
            if d > self.rng_px() and d > pd - 6 and not (t.naval if isinstance(t, Unit) else False) \
                    and not can_reach(w, self, t):
                self.give_up(w, t)
                return
            self.prog = (w.time, d)
        blast = self.d.get('blast')
        rng = 6 if blast else self.rng_px()
        minr = self.d.get('minrng', 0) * TILE
        if minr and d < minr:
            # слишком близко для пушек — отходим
            ang = math.atan2(self.y - t.center()[1], self.x - t.center()[0])
            self.step_toward(w, self.x + math.cos(ang) * TILE, self.y + math.sin(ang) * TILE, dt)
            return
        if not self.approach(w, t, rng, dt):
            return
        self.face_to(t)
        if self.cool > 0:
            return
        self.cool = self.reload()
        self.swing = 0.35
        if blast:
            self.explode(w)
            return
        if self.d.get('fire'):
            w.damage(t, self, w.calc_damage(self, t, False))
            return
        siege = bool(self.d.get('siege'))
        dmg = w.calc_damage(self, t, not siege)
        pr = Projectile(self.x, self.y - 14, t, dmg, self)
        if siege:
            pr.ball = True
            pr.speed = 300
        w.projectiles.append(pr)
        w.emit('arrow', self.x, self.y, self.owner, self.kind)

    def explode(self, w):
        """Подрыв: урон всем не-союзникам в радиусе (корабли, юниты, здания), сам тонет."""
        R = self.d['blast'] * TILE
        for o in list(w.units):
            if o is self or not o.alive or w.allied(o.owner, self.owner):
                continue
            if math.hypot(o.x - self.x, o.y - self.y) - o.radius <= R:
                w.damage(o, self, w.calc_damage(self, o, False))
        for b in list(w.buildings):
            if b.alive and not w.allied(b.owner, self.owner) and b.dist_px(self.x, self.y) <= R:
                w.damage(b, self, w.calc_damage(self, b, False))
        w.emit('explode', self.x, self.y, self.owner, self.kind)
        w.decals.append(['blast', self.x, self.y, self.owner, w.time])
        w.damage(self, self, self.hp + 1)

    # ---- рыбалка
    def gather_target_valid(self, t):
        return t is not None and t.alive and isinstance(t, Node) and t.kind in FISH

    def do_gather(self, w, dt):
        t = self.target
        if not self.gather_target_valid(t):
            nt = find_fish(w, self, self.x, self.y, 12)
            if nt is not None:
                self.target = nt
                self.path_target = None
                return
            self.target = None
            if self.carry > 0:
                self.cmd_return()
            else:
                self.state = 'idle'
            return
        if self.carry > 0 and self.carry_res != 'food':
            self.carry = 0
        if self.carry >= self.capacity():
            self.cmd_return()
            return
        if not self.approach(w, t, 14, dt):
            return
        rate = self.p.stat('gather', self.kind, NODE_DEFS[t.kind].get('ship_rate', 0.49), 'food', 'fish')
        self.face_to(t)
        self.work += dt
        if self.work > 1.5:
            self.work = 0.0
            self.swing = 0.3
            w.emit('work', self.x, self.y, self.owner, 'fish')
        amt = min(rate * dt, t.amount)
        t.amount -= amt
        self.carry += amt
        self.carry_res = 'food'
        if t.amount <= 0:
            w.deplete(t)

    def do_return(self, w, dt):
        if self.carry <= 0:
            self.resume_gather(w)
            return
        d = self.drop
        if d is None or not d.alive or not d.complete or not d.d.get('water'):
            d = nearest_dock(w, self)
            self.drop = d
            self.path_target = None
        if d is None:
            self.state = 'idle'
            return
        if self.approach(w, d, 14, dt):
            amt = int(self.carry + 0.001)
            self.p.res['food'] += amt
            self.p.gathered['food'] += amt
            self.carry = 0
            self.drop = None
            self.resume_gather(w)

    def resume_gather(self, w):
        t = self.target
        if self.gather_kind and self.gather_target_valid(t):
            self.state = 'gather'
            self.path_target = None
            return
        if self.gather_kind:
            nt = find_fish(w, self, self.x, self.y, 14)
            if nt is not None:
                self.cmd_gather(nt)
                return
        self.state = 'idle'
        self.target = None

    # ---- транспорт
    def load_tick(self, w):
        cap = self.cargo_cap()
        keep = []
        for u in self.to_load:
            if not u.alive or u.owner != self.owner or len(self.cargo) >= cap:
                continue
            if math.hypot(u.x - self.x, u.y - self.y) <= self.radius + u.radius + 1.6 * TILE:
                self.board(w, u)
                continue
            keep.append(u)
        self.to_load = keep if w.time - self.load_t < 60 else []

    def board(self, w, u):
        u.stop()
        u.alive = False             # вне мира, пока плывёт (из World.units уберёт общий фильтр)
        u.aboard = self
        u.path = []
        self.cargo.append(u)
        w.emit('board', self.x, self.y, self.owner, u.kind)

    def do_unload(self, w, dt):
        if not self.cargo or self.unload_pt is None:
            self.state = 'idle'
            self.unload_pt = None
            return
        if self.landing is None:
            if w.path_budget <= 0:
                return
            w.path_budget -= 1
            self.landing = landing_spot(w, self, *self.unload_pt)
            if self.landing is None:
                self.state = 'idle'
                return
            lx, ly, wx, wy = self.landing
            self.path = find_path_water(w, self.tile(), [(wx, wy)], wx, wy)
            self.dest = None
        lx, ly, wx, wy = self.landing
        cx, cy = (lx + 0.5) * TILE, (ly + 0.5) * TILE
        if math.hypot(cx - self.x, cy - self.y) <= self.radius + 1.4 * TILE:
            self.unload(w, lx, ly)
            return
        if self.walk_path(w, dt):
            if math.hypot(cx - self.x, cy - self.y) <= self.radius + 2.2 * TILE:
                self.unload(w, lx, ly)
            else:
                self.step_toward(w, cx, cy, dt)
                if w.time > self.repath_t:
                    self.repath_t = w.time + 2.0
                    self.landing = None

    def unload(self, w, lx, ly):
        """Высадить всех на свободную сушу рядом с (lx, ly) и отправить к точке приказа."""
        comp = land_comp(w, lx, ly)
        spots = []
        for r in range(0, 5):
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    x, y = lx + dx, ly + dy
                    if w.passable(x, y) and land_comp(w, x, y) == comp:
                        spots.append((x, y))
            if len(spots) >= len(self.cargo):
                break
        if not spots:
            self.state = 'idle'
            return
        px, py = self.unload_pt
        dest_ok = w.passable(int(px // TILE), int(py // TILE)) and land_comp(w, int(px // TILE), int(py // TILE)) == comp
        for i, u in enumerate(self.cargo):
            x, y = spots[i % len(spots)]
            u.x = (x + 0.5) * TILE + random.uniform(-5, 5)
            u.y = (y + 0.5) * TILE + random.uniform(-5, 5)
            u.aboard = None
            u.alive = True
            u.stop()
            w.units.append(u)
            if dest_ok and math.hypot(px - u.x, py - u.y) > 2 * TILE:
                u.cmd_move(px + random.uniform(-20, 20), py + random.uniform(-20, 20))
        w.emit('unload', self.x, self.y, self.owner, self.kind)
        self.cargo = []
        self.unload_pt = None
        self.landing = None
        self.state = 'idle'


def landing_spot(w, s, x, y):
    """Где пристать для высадки у точки (x, y): (суша x, y, вода x, y) — берег акватории корабля,
    ближайший к точке (и на том же острове, если точка на суше)."""
    comp = ship_comp(w, s)
    tx, ty = int(x // TILE), int(y // TILE)
    lc = land_comp(w, tx, ty)
    best, bd = None, 1e18
    for (lx, ly, wx, wy, l, c) in shores(w):
        if c != comp or (lc >= 0 and l != lc) or not w.passable(lx, ly) or not water_free(w, wx, wy):
            continue
        d = (lx - tx) ** 2 + (ly - ty) ** 2
        if d < bd:
            bd, best = d, (lx, ly, wx, wy)
    return best


def order_board(w, units, ship):
    """Посадка: транспорт идёт к берегу у отряда, отряд — к транспорту; кто подошёл — садится."""
    units = [u for u in units if not u.naval and u.alive and u.owner == ship.owner]
    room = ship.cargo_cap() - len(ship.cargo)
    if not units or room <= 0:
        return False
    units = units[:room]
    comp = ship_comp(w, ship)
    ux = sum(u.x for u in units) / len(units)
    uy = sum(u.y for u in units) / len(units)
    lc = land_comp(w, *units[0].tile())
    best, bd = None, 1e18
    for (lx, ly, wx, wy, l, c) in shores(w):
        if c != comp or l != lc or not w.passable(lx, ly) or not water_free(w, wx, wy):
            continue
        d = math.hypot((lx + 0.5) * TILE - ux, (ly + 0.5) * TILE - uy) + \
            0.5 * math.hypot((wx + 0.5) * TILE - ship.x, (wy + 0.5) * TILE - ship.y)
        if d < bd:
            bd, best = d, (lx, ly, wx, wy)
    if best is None:
        return False
    lx, ly, wx, wy = best
    ship.stop()
    ship.cmd_move((wx + 0.5) * TILE, (wy + 0.5) * TILE)
    for i, u in enumerate(units):
        u.cmd_move((lx + 0.5) * TILE + (i % 3 - 1) * 8, (ly + 0.5) * TILE + (i // 3 - 1) * 8)
    ship.to_load = [u for u in ship.to_load if u.alive and u not in units] + units
    ship.load_t = w.time
    return True


# ============================================================ столкновения кораблей
def separate_ships(w):
    ships = [u for u in w.units if u.naval]
    if len(ships) < 2:
        return
    C = 2 * TILE
    grid = {}
    keys = []
    for s in ships:
        k = (int(s.x // C), int(s.y // C))
        keys.append(k)
        lst = grid.get(k)
        if lst is None:
            grid[k] = [s]
        else:
            lst.append(s)
    nbc = {}
    for (cx, cy) in grid:
        nb = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                lst = grid.get((cx + dx, cy + dy))
                if lst is not None:
                    nb += lst
        nbc[(cx, cy)] = nb if len(nb) > 1 else None
    for s, k in zip(ships, keys):
        nb = nbc[k]
        if nb is None:
            continue                # рядом никого — толкаться не с кем
        px = py = 0.0
        for o in nb:
            if o is s:
                continue
            ddx, ddy = s.x - o.x, s.y - o.y
            mind = s.radius + o.radius - 4
            d2 = ddx * ddx + ddy * ddy
            if d2 < mind * mind:
                d = math.sqrt(d2)
                if d < 0.01:
                    a = random.uniform(0, math.tau)
                    ddx, ddy, d = math.cos(a), math.sin(a), 1.0
                push = (mind - d) * 0.35
                px += ddx / d * push
                py += ddy / d * push
        if px or py:
            if s.state in ('gather',) and not s.path:
                px *= 0.3
                py *= 0.3
            nx, ny = s.x + px, s.y + py
            if water_px(w, nx, ny):
                s.x, s.y = nx, ny


# ============================================================ генерация карты
def gen_water(w, starts, slot_ang, R):
    """Вырезать воду до расстановки ресурсов. coast — море в центре, одинаково далеко от всех;
    islands — всё вода, у каждого игрока свой остров (союзники соединены перешейком)."""
    W, H = w.W, w.H
    mx, my = (W - 1) / 2, (H - 1) / 2
    n = len(starts)
    ph = [random.uniform(0, math.tau) for _ in range(4)]
    T = w.terrain
    if w.map_type == 'coast':
        Rs = max(10.0, R - 18)
        for y in range(H):
            for x in range(W):
                a = math.atan2(y - my, x - mx)
                r = Rs + 1.6 * math.sin(3 * a + ph[0]) + 1.1 * math.sin(5 * a + ph[1]) + \
                    0.7 * math.sin(n * 2 * a + ph[2])
                if math.hypot(x - mx, y - my) < r + random.uniform(-0.4, 0.4):
                    T[y][x] = 1
        # у каждого игрока — одинаковая бухта, сдвинутая вбок от направления на центр
        off = random.choice((-1, 1)) * random.uniform(0.35, 0.6)
        for a in slot_ang:
            b = a + off / 3
            cx, cy = mx + math.cos(b) * (Rs + 2), my + math.sin(b) * (Rs + 2)
            for y in range(int(cy) - 6, int(cy) + 7):
                for x in range(int(cx) - 6, int(cx) + 7):
                    if 0 <= x < W and 0 <= y < H and math.hypot(x - cx, y - cy) < 4.2:
                        T[y][x] = 1
    else:
        for y in range(H):
            for x in range(W):
                T[y][x] = 1
        # радиус острова — чтобы между чужими островами оставался пролив
        D = min((math.hypot(starts[i][0] - starts[j][0], starts[i][1] - starts[j][1])
                 for i in range(n) for j in range(i + 1, n)
                 if w.players[i].team != w.players[j].team), default=60)
        SH = 5                                  # остров чуть сдвинут от края к центру карты
        Ri = max(13.0, min(24.0, D / 2 - SH - 5))
        for pid, (sx0, sy0) in enumerate(starts):
            a0 = slot_ang[pid]
            sx, sy = sx0 - math.cos(a0) * SH, sy0 - math.sin(a0) * SH
            for y in range(int(sy - Ri - 4), int(sy + Ri + 5)):
                for x in range(int(sx - Ri - 4), int(sx + Ri + 5)):
                    if not (0 <= x < W and 0 <= y < H):
                        continue
                    a = math.atan2(y - sy, x - sx) - a0
                    r = Ri + 1.5 * math.sin(3 * a + ph[0]) + 1.0 * math.sin(5 * a + ph[1])
                    if math.hypot(x - sx, y - sy) < r:
                        T[y][x] = 0
        # перешейки между союзниками
        for i in range(n):
            for j in range(i + 1, n):
                if w.players[i].team != w.players[j].team:
                    continue
                (x0, y0), (x1, y1) = starts[i], starts[j]
                L = max(1, int(math.hypot(x1 - x0, y1 - y0)))
                for q in range(L + 1):
                    cx, cy = x0 + (x1 - x0) * q / L, y0 + (y1 - y0) * q / L
                    for y in range(int(cy) - 5, int(cy) + 6):
                        for x in range(int(cx) - 5, int(cx) + 6):
                            if 0 <= x < W and 0 <= y < H and math.hypot(x - cx, y - cy) < 4.5:
                                T[y][x] = 0
        # вода по краю карты (острова не упираются в край)
        for y in range(H):
            for x in range(W):
                if min(x, y, W - 1 - x, H - 1 - y) < 2:
                    T[y][x] = 1
    # одиночные клетки воды/суши сглаживаем
    for _ in range(2):
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                s = sum(T[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
                if T[y][x] == 1 and s <= 1:
                    T[y][x] = 0
                elif T[y][x] == 0 and s >= 3:
                    T[y][x] = 1
    # стартовую площадку не заливаем
    for sx, sy in starts:
        for y in range(sy - 6, sy + 7):
            for x in range(sx - 6, sx + 7):
                if 0 <= x < W and 0 <= y < H:
                    T[y][x] = 0


def place_fish(w, starts, fwd):
    """Рыба — поровну каждому игроку: стайки у берега и глубоководная рыба подальше в море.
    Направления одинаковы относительно «вперёд» (к центру карты), как и у остальных ресурсов."""
    n = len(starts)

    def put(kind, x, y):
        if water_free(w, x, y) and all(math.hypot(x - sx, y - sy) > 6 for sx, sy in starts):
            nd = Node(kind, x, y)
            w.nodes.append(nd)
            w.occ[y][x] = nd
            return True
        return False

    def coast_tile(x, y):
        return water_free(w, x, y) and any(0 <= x + dx < w.W and 0 <= y + dy < w.H and w.terrain[y + dy][x + dx] in (0, 2)
                                           for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))

    def open_tile(x, y):
        return water_free(w, x, y) and all(0 <= x + dx < w.W and 0 <= y + dy < w.H and w.terrain[y + dy][x + dx] == 1
                                           for dx in (-2, -1, 0, 1, 2) for dy in (-2, -1, 0, 1, 2))

    def ray(pid, rel):
        """Первая клетка воды по лучу от старта (и сам угол)."""
        sx, sy = starts[pid]
        a = fwd[pid] + rel
        for d in range(5, 40):
            x, y = int(round(sx + math.cos(a) * d)), int(round(sy + math.sin(a) * d))
            if not (0 <= x < w.W and 0 <= y < w.H):
                return None
            if w.terrain[y][x] == 1:
                return x, y, a
        return None

    if w.map_type != 'islands':
        _place_fish_sea(w, starts, fwd, put, coast_tile, open_tile)
        return
    rels = [random.uniform(0, math.tau)]
    rels += [rels[0] + math.tau / 3 + random.uniform(-0.4, 0.4), rels[0] - math.tau / 3 + random.uniform(-0.4, 0.4)]
    for gi, rel in enumerate(rels):
        k_shore = 3 if gi < 2 else 2
        for pid in range(n):
            r = ray(pid, rel)
            if r is None:
                continue
            x0, y0, a = r
            _shore_school(x0, y0, k_shore, put, coast_tile)
            # глубоководная — дальше по тому же лучу, через 3–4 клетки друг от друга
            placed, nxt = 0, 4
            for d in range(4, 24):
                if placed >= 2:
                    break
                if d < nxt:
                    continue
                x, y = int(round(x0 + math.cos(a) * d)), int(round(y0 + math.sin(a) * d))
                for ox, oy in ((0, 0), (1, 0), (0, 1), (-1, 0), (0, -1)):
                    if open_tile(x + ox, y + oy) and put('deep_fish', x + ox, y + oy):
                        placed += 1
                        nxt = d + 4
                        break


def _shore_school(x0, y0, k, put, coast_tile):
    """Стайка у берега: k клеток кромки, ближайших к (x0, y0)."""
    cand = sorted(((x - x0) ** 2 + (y - y0) ** 2, x, y) for y in range(y0 - 4, y0 + 5)
                  for x in range(x0 - 4, x0 + 5) if coast_tile(x, y))
    placed = 0
    for _, x, y in cand:
        if placed >= k:
            break
        if put('shore_fish', x, y):
            placed += 1


def _place_fish_sea(w, starts, fwd, put, coast_tile, open_tile):
    """Море в центре: лучи из центра карты под одинаковыми углами к каждому игроку —
    у берега перед игроком стайки, в открытом море глубоководная рыба."""
    mx, my = (w.W - 1) / 2, (w.H - 1) / 2
    n = len(starts)
    s = random.choice((-1, 1))
    for pid in range(n):
        base = fwd[pid] + math.pi          # угол игрока, если смотреть из центра
        for rel, k in ((s * 0.22, 3), (-s * 0.3, 3), (s * 0.55, 2)):
            a = base + rel
            last = None
            for d in range(2, max(w.W, w.H)):
                x, y = int(round(mx + math.cos(a) * d)), int(round(my + math.sin(a) * d))
                if not (0 <= x < w.W and 0 <= y < w.H) or w.terrain[y][x] != 1:
                    break
                last = (x, y, d)
            if last is None:
                continue
            x0, y0, dmax = last
            _shore_school(x0, y0, k, put, coast_tile)
        # глубоководная: две-три рыбы в открытом море перед игроком
        for rel, frac in ((0.0, 0.62), (s * 0.4, 0.45), (-s * 0.5, 0.75)):
            a = base + rel
            last = 0
            for d in range(2, max(w.W, w.H)):
                x, y = int(round(mx + math.cos(a) * d)), int(round(my + math.sin(a) * d))
                if not (0 <= x < w.W and 0 <= y < w.H) or w.terrain[y][x] != 1:
                    break
                last = d
            d = int(last * frac)
            x, y = int(round(mx + math.cos(a) * d)), int(round(my + math.sin(a) * d))
            for ox, oy in ((0, 0), (1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, -1)):
                if open_tile(x + ox, y + oy) and put('deep_fish', x + ox, y + oy):
                    break


# ============================================================ интерфейс: приказы, кнопки
def ui_command(g, w, units, wx, wy, target):
    """Приказы с участием кораблей (ПКМ). True — приказ обработан здесь."""
    ships = [u for u in units if u.naval]
    land = [u for u in units if not u.naval]
    # сухопутные юниты → ПКМ по своему транспорту: посадка
    if land and isinstance(target, Ship) and target.owner == 0 and target.cargo_cap() > 0:
        if order_board(w, land, target):
            g.markers.append((wx, wy, (120, 200, 255), w.time))
            w.emit('command', wx, wy, 0, 'board')
        return True
    if not ships:
        return False
    tx, ty = int(wx // TILE), int(wy // TILE)
    on_land = 0 <= tx < w.W and 0 <= ty < w.H and w.terrain[ty][tx] in (0, 2)
    rest = []
    for s in ships:
        if target is not None and w.hostile(0, getattr(target, 'owner', -1)) and s.d['atk'] > 0:
            s.cmd_attack(target)
        elif isinstance(target, Node) and target.kind in FISH and s.d.get('fisher'):
            s.cmd_gather(target)
        elif isinstance(target, Building) and target.owner == 0 and target.d.get('water') and s.carry > 0:
            s.cmd_return(target)
        elif s.cargo and on_land and not isinstance(target, Unit):
            s.cmd_unload(wx, wy)
        else:
            rest.append(s)
    if rest:
        g.group_move(rest, wx, wy)
    if land:
        return _land_part(g, w, land, wx, wy, target)
    col = (255, 80, 60) if target is not None and w.hostile(0, getattr(target, 'owner', -1)) else (255, 255, 255)
    g.markers.append((wx, wy, col, w.time))
    w.emit('command', wx, wy, 0, 'move')
    return True


def _land_part(g, w, land, wx, wy, target):
    """Смешанный выбор: корабли уже получили приказ, сухопутным — обычный путь интерфейса."""
    keep = g.selected
    g.selected = land
    try:
        g.command(wx, wy, target)
    finally:
        g.selected = keep
    return True


def unit_buttons(w, units):
    """Доп. кнопки для выбранных кораблей: высадка у ближайшего берега."""
    items = []
    tr = [u for u in units if u.naval and u.cargo]
    if tr:
        n = sum(len(u.cargo) for u in tr)
        items.append(dict(icon=('unload', n), act=('unload', None), ok=True,
                          tip=['Высадить', {}, f'На ближайший берег: {n}']))
    return items


def press_unload(w, units):
    for s in units:
        if s.naval and s.cargo:
            best = landing_spot(w, s, s.x, s.y)
            if best:
                lx, ly, _, _ = best
                s.cmd_unload((lx + 0.5) * TILE, (ly + 0.5) * TILE)
