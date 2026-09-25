"""Приказы юнитов сверх базовых Unit.cmd_* (как в AoE2 DE): очередь Shift-приказов (точки маршрута),
патруль, охрана, следование, атака с ходу, атака по земле, ремонт, стойки, строй и общая скорость группы,
точки сбора (в т. ч. в гарнизон и несколько точек).

Поля юнита (значения по умолчанию — атрибуты класса Unit, см. world.py):
  stance     — 'aggressive' | 'defensive' | 'stand_ground' | 'no_attack'
  orders     — очередь следующих приказов [(вид, *аргументы)], None — пусто
  mission    — длительный приказ: ['amove', x, y, попытки] | ['patrol', точки, i, попытки] |
               ['guard', цель] | ['follow', цель]
  home       — где юнит стоял, когда сам ввязался в бой (оборонительная стойка / стоять на месте)
  auto       — текущая атака начата самим юнитом (не приказом игрока)
  form_speed — скорость строя (px/с): группа идёт со скоростью самого медленного
  gpt        — точка «атаки по земле»

ИИ пользуется только cmd_* и этих полей не трогает: у его юнитов стойка агрессивная, очередь пуста —
поведение прежнее.
"""
import math
import random

from .data import TILE

STANCES = ('aggressive', 'defensive', 'stand_ground', 'no_attack')
FORMATIONS = ('line', 'box', 'staggered', 'flank')
PATROL_MAX = 10          # DE: у патруля и атаки с ходу — до 10 точек
FLAGS_SHOWN = 10         # DE: очередь без предела, но флажков видно 10
DEF_CHASE = 5 * TILE     # оборонительная стойка: дальше этого от места не преследует
REPAIR_HP_S = 750 / 60   # ремонт здания одним жителем, ОЗ/с (openage repair.md: 750 ОЗ/мин)
REPAIR_UNIT_K = 0.25     # осада и корабли чинятся вчетверо медленнее
REPAIR_COST_K = 0.5      # полный ремонт стоит половину постройки (без золота)
SCAN_DT = 0.4


# ============================================================ очередь
def clear(u):
    """Новый прямой приказ игрока: забыть очередь, длительный приказ, «дом» и строй."""
    u.orders = None
    u.mission = None
    u.home = None
    u.auto = False
    u.form_speed = None


def busy(u):
    return u.state != 'idle' or bool(u.orders) or u.mission is not None


def issue(u, w, item, queue=False):
    """Отдать приказ item = (вид, *аргументы). queue — Shift: в конец очереди (если юнит чем-то занят)."""
    if queue and busy(u):
        if u.orders is None:
            u.orders = []
        u.orders.append(item)
        return True
    clear(u)
    return run(u, w, item)


def _alive(t):
    return t is not None and t.alive and not getattr(t, 'dead', False)


def run(u, w, item):
    """Выполнить приказ сейчас. False — цель пропала, приказ пропущен."""
    k = item[0]
    if k == 'move':
        u.cmd_move(item[1], item[2])
        if len(item) > 3 and item[3]:
            u.form_speed = item[3]
    elif k == 'attack':
        if not _alive(item[1]) and not (getattr(item[1], 'dead', False) and u.kind == 'villager'):
            return False
        u.cmd_attack(item[1])
    elif k == 'gather':
        if not item[1].alive:
            return False
        u.cmd_gather(item[1])
    elif k == 'build':
        if not item[1].alive or item[1].complete:
            return False
        u.cmd_build(item[1])
    elif k == 'return':
        u.cmd_return(item[1])
    elif k == 'garrison':
        if not item[1].alive:
            return False
        u.cmd_garrison(item[1])
    elif k == 'heal':
        u.cmd_heal(item[1])
    elif k == 'repair':
        return cmd_repair(u, item[1])
    elif k == 'patrol':
        pts = [(u.x, u.y)] + list(item[1])[:PATROL_MAX]
        u.mission = ['patrol', pts, 1, 0]
        u.cmd_move(*pts[1])
    elif k == 'amove':
        u.mission = ['amove', item[1], item[2], 0]
        u.cmd_move(item[1], item[2])
    elif k == 'guard':
        if not _alive(item[1]):
            return False
        u.mission = ['guard', item[1]]
        u.mis_t = 0.0
    elif k == 'follow':
        if not _alive(item[1]):
            return False
        u.mission = ['follow', item[1]]
        u.mis_t = 0.0
    elif k == 'aground':
        return cmd_attack_ground(u, item[1], item[2])
    elif k == 'rally':
        rally_order(w, u, item[1])
    elif k == 'stop':
        u.stop()
    elif k in ('relic', 'relic_in'):          # монах: поднять реликвию / отнести в монастырь (game/relics.py)
        from . import relics
        return relics.cmd_pick(u, w, item[1]) if k == 'relic' else relics.cmd_deposit(u, w, item[1])
    else:
        return False
    return True


def near(u, x, y, r=0.9 * TILE):
    return abs(u.x - x) <= r and abs(u.y - y) <= r


def on_idle(u, w):
    """Юнит стоит без дела, но у него есть очередь / длительный приказ / место, куда вернуться."""
    m = u.mission
    if m is not None:
        k = m[0]
        if k == 'amove':
            if near(u, m[1], m[2], 1.5 * TILE) or m[3] >= 3:
                u.mission = None
            else:
                m[3] += 1
                u.cmd_move(m[1], m[2])
                return
        elif k == 'patrol':
            pts = m[1]
            if near(u, *pts[m[2]], r=1.5 * TILE) or m[3] >= 2:
                m[2] = (m[2] + 1) % len(pts)
                m[3] = 0
            else:
                m[3] += 1
            u.cmd_move(*pts[m[2]])
            return
        else:
            return          # охрана / следование — в tick
    while u.orders and u.state == 'idle':
        run(u, w, u.orders.pop(0))
    if u.state == 'idle' and u.home is not None and u.stance != 'aggressive':
        hx, hy = u.home
        if not near(u, hx, hy, 0.6 * TILE) and w.time >= getattr(u, '_ret_t', 0.0):
            u._ret_t = w.time + 2.0
            u.cmd_move(hx, hy)


# ============================================================ длительные приказы
def scan(u, w):
    """Враг рядом по стойке (для атаки с ходу / патруля / охраны)."""
    r = scan_radius(u)
    if r <= 0 or u.cls == 'vil' or u.d.get('monk'):
        return None
    d = u.d
    return w.nearest_enemy(u, r, buildings=bool(d.get('bld_only') or d.get('pack')) or u.mission[0] == 'amove',
                           minr=u.minr_px(), units=not d.get('bld_only'))


def tick(u, w, dt):
    """Раз в SCAN_DT: атака с ходу / патруль ищут врагов по пути, охрана держится у цели, следование — за целью."""
    if w.time < u.mis_t:
        return
    u.mis_t = w.time + SCAN_DT
    m = u.mission
    k = m[0]
    st = u.state
    if k in ('amove', 'patrol'):
        if st == 'move' and u.stance != 'no_attack':
            e = scan(u, w)
            if e is not None:
                u.cmd_attack(e)
                u.auto = True
        return
    t = m[1]
    if not _alive(t) or (hasattr(t, 'owner') and t.owner != u.owner and not w.allied(u.owner, t.owner)
                         and k == 'guard'):
        u.mission = None
        return
    if st not in ('idle', 'move'):
        return
    tx, ty = t.center()
    if k == 'guard':
        if u.stance != 'no_attack' and u.cls != 'vil':
            e = w.nearest_enemy(u, u.los() * TILE, buildings=False, units=True)
            if e is not None and math.hypot(e.x - tx, e.y - ty) <= 6 * TILE:
                u.cmd_attack(e)
                u.auto = True
                return
    lim = 2.5 * TILE if hasattr(t, 'radius') else (max(t.w, t.h) / 2 + 2) * TILE
    if math.hypot(tx - u.x, ty - u.y) > lim:
        a = math.atan2(u.y - ty, u.x - tx)
        rr = lim * 0.6
        u.cmd_move(tx + math.cos(a) * rr, ty + math.sin(a) * rr)


# ============================================================ стойки
def scan_radius(u):
    st = u.stance
    if st == 'no_attack':
        return 0
    if st == 'stand_ground' or u.d.get('pack'):
        return u.rng_px() + (0.4 * TILE if u.d['rng'] <= 0 else 0)
    return u.los() * TILE


def engage(u, e):
    """Юнит сам ввязывается в бой с e (увидел в обзоре / ответил на удар) — по стойке. True — атакует."""
    st = u.stance
    if st == 'no_attack':
        return False
    if st == 'stand_ground' and u.dist_to(e) > u.rng_px() + 0.4 * TILE:
        return False
    u.cmd_attack(e)
    u.auto = True
    if st != 'aggressive' and u.home is None:
        u.home = (u.x, u.y)
    return True


def may_chase(u, t):
    """Юнит, сам ввязавшийся в бой, ещё преследует t? (оборонительная — недалеко, стоять — только в зоне)."""
    st = u.stance
    if st == 'stand_ground':
        return u.dist_to(t) <= u.rng_px() + 0.4 * TILE
    if st == 'defensive' and u.home is not None:
        tx, ty = t.center()
        return math.hypot(tx - u.home[0], ty - u.home[1]) <= DEF_CHASE + u.rng_px()
    return st != 'no_attack'


def set_stance(units, st):
    for u in units:
        u.stance = st
        if st == 'aggressive':
            u.home = None
        elif u.home is None:
            u.home = (u.x, u.y)
        if st == 'no_attack' and u.state == 'attack' and u.auto:
            u.stop()


# ============================================================ ремонт
def repairable(u, t):
    """Житель u может чинить t: своё достроенное раненое здание, свою осаду или корабль."""
    if u.kind != 'villager' or t is None or not t.alive or t.owner != u.owner or t.hp >= t.max_hp:
        return False
    if hasattr(t, 'radius'):
        return t.cls in ('siege', 'ship') and not getattr(t, 'dead', False)
    return t.complete and t.kind != 'farm'


def cmd_repair(u, t):
    if not repairable(u, t):
        return False
    u.release()
    u.state = 'repair'
    u.target = t
    u.path_target = None
    return True


def _repair_cost(p, t):
    unit = hasattr(t, 'radius')
    cost = p.cost_of('unit' if unit else 'bld', t.kind)
    return {r: v * REPAIR_COST_K / max(1.0, t.max_hp) for r, v in cost.items() if v and r != 'gold'}


def do_repair(u, w, dt):
    t = u.target
    if not repairable(u, t):
        u.state = 'idle'
        u.target = None
        return
    if hasattr(t, 'radius'):
        near_ok = u.approach(w, t, 12, dt)
    else:
        near_ok = u.approach(w, t, 10, dt)
    if not near_ok:
        return
    u.face_to(t)
    # сколько жителей чинят t в этом шаге: первый — полная скорость, каждый следующий +50%
    if getattr(t, '_rep_t', None) != w.time:
        t._rep_prev = getattr(t, '_rep_cur', 1)
        t._rep_cur = 0
        t._rep_t = w.time
    t._rep_cur += 1
    n = max(1, t._rep_prev, t._rep_cur)
    base = REPAIR_HP_S * (REPAIR_UNIT_K if hasattr(t, 'radius') else 1.0)
    rate = base * (1 + 0.5 * (n - 1)) / n * u.p.stat('build', u.kind, 1)
    dh = min(rate * dt, t.max_hp - t.hp)
    p = u.p
    debt = getattr(p, 'rep_debt', None)
    if debt is None:
        debt = p.rep_debt = {}
    for r, per in _repair_cost(p, t).items():
        v = debt.get(r, 0.0) + per * dh
        if v >= 1.0:
            n_int = int(v)
            if p.res.get(r, 0) < n_int:
                if p is w.players[w.human]:
                    w.msg('Не хватает ресурсов на ремонт', (255, 150, 90))
                u.state = 'idle'
                u.target = None
                return
            p.res[r] -= n_int
            v -= n_int
        debt[r] = v
    t.hp = min(t.max_hp, t.hp + dh)
    u.work += dt
    if u.work > 0.8:
        u.work = 0.0
        u.swing = 0.3
        w.emit('work', u.x, u.y, u.owner, 'build')


# ============================================================ атака по земле
def can_attack_ground(u):
    return u.d.get('blast', 0) > 0 and not u.naval and u.d['atk'] > 0


def cmd_attack_ground(u, x, y):
    if not can_attack_ground(u):
        return False
    u.release()
    u.state = 'aground'
    u.gpt = (x, y)
    u.target = None
    u.path = []
    u.dest = None
    u.path_target = None
    return True


def do_attack_ground(u, w, dt):
    from .world import Projectile
    x, y = u.gpt
    d = math.hypot(x - u.x, y - u.y)
    rng = u.rng_px()
    mr = u.minr_px()
    if d > rng:
        if u.d.get('pack') and not u.packed:
            u.start_pack(w, True)
            return
        if u.path_target != 'ground' or (not u.path and w.time >= u.repath_t):
            if w.path_budget <= 0:
                return
            w.path_budget -= 1
            u.path_target = 'ground'
            u.repath_t = w.time + 2.0
            gx, gy = int(x // TILE), int(y // TILE)
            goal = (gx, gy) if w.passable(gx, gy) else w.nearest_free_tile(gx, gy)
            u.path = w.find_path(u.tile(), [goal], goal[0], goal[1], owner=u.owner)
            u.dest = None
        if u.path:
            u.walk_path(w, dt)
        else:
            u.step_toward(w, x, y, dt)
        return
    u.path = []
    if mr and d < mr:
        u.state = 'idle'
        return
    dx, dy = x - u.x, y - u.y
    if d > 0.1:
        u.face = (dx / d, dy / d)
    if u.d.get('pack') and u.packed:
        u.start_pack(w, False)
        return
    if u.cool <= 0:
        u.cool = u.reload()
        u.swing = 0.3
        px, py = x, y
        acc = u.acc()
        if acc < 1.0 and random.random() > acc:
            a = random.uniform(0, math.tau)
            r = random.uniform(0.5, 1.3) * TILE
            px, py = px + math.cos(a) * r, py + math.sin(a) * r
        w.projectiles.append(Projectile(u.x, u.y - 10, None, u.atk(), u, 0.0, (px, py),
                                        u.d.get('blast', 0) * TILE, False))
        w.emit('arrow', u.x, u.y, u.owner, u.kind)


# ============================================================ строй
_ROLE = {'cav': 0, 'inf': 1, 'vil': 1, 'arch': 2}      # спереди назад: конница, пехота, стрелки, осада/монахи


def role(u):
    return _ROLE.get(u.cls, 3)


def spacing(units):
    """Шаг строя — по самому широкому юниту (openage formations.md)."""
    return max(2 * u.radius for u in units) + 6


def _rows(n, form):
    """Сколько юнитов в ряду: строй шире, чем глубже."""
    if n <= 4:
        return n
    per = int(math.ceil(math.sqrt(n * (3.0 if form != 'box' else 1.0))))
    return max(1, min(n, per))


def layout(units, wx, wy, form='line', heading=None):
    """[(юнит, x, y)] — места в строю вокруг точки (wx, wy); heading — (dx, dy) направление движения."""
    n = len(units)
    if n == 0:
        return []
    if n == 1:
        return [(units[0], wx, wy)]
    if heading is None:
        cx = sum(u.x for u in units) / n
        cy = sum(u.y for u in units) / n
        heading = (wx - cx, wy - cy)
    hx, hy = heading
    hl = math.hypot(hx, hy)
    if hl < 1e-3:
        hx, hy, hl = 1.0, 1.0, math.sqrt(2)
    fx, fy = hx / hl, hy / hl          # вперёд
    sx, sy = -fy, fx                   # вправо
    sp = spacing(units)
    if form == 'staggered':
        sp *= 1.7
    groups = [[] for _ in range(4)]
    for u in units:
        groups[role(u)].append(u)
    slots = []                         # (вбок, назад, группа)
    if form == 'box':
        # коробка: ближний бой — по периметру квадрата, стрелки и осада — внутри
        melee = groups[0] + groups[1]
        inner = groups[2] + groups[3]
        side = 3
        while 4 * (side - 1) < len(melee) or (side - 2) ** 2 < len(inner):
            side += 1
        ring = [(c, 0) for c in range(side)] + [(side - 1, r) for r in range(1, side)] + \
               [(c, side - 1) for c in range(side - 2, -1, -1)] + [(0, r) for r in range(side - 2, 0, -1)]
        step = len(ring) / max(1, len(melee))
        half = (side - 1) / 2
        for i, u in enumerate(melee):
            c, r = ring[int(i * step)]
            slots.append((u, (c - half) * sp, (r - half) * sp))
        k = side - 2
        for i, u in enumerate(inner):
            r, c = divmod(i, k)
            slots.append((u, (c + 1 - half) * sp, (r + 1 - half) * sp))
        return _assign(slots, wx, wy, fx, fy, sx, sy)
    back = 0.0
    row_len = _rows(max(len(g) for g in groups if g), form)
    for gi, g in enumerate(groups):
        if not g:
            continue
        per = min(row_len, len(g))
        nrows = int(math.ceil(len(g) / per))
        for r in range(nrows):
            cnt = min(per, len(g) - r * per)
            for c in range(cnt):
                lat = (c - (cnt - 1) / 2) * sp
                if form == 'staggered' and r % 2:
                    lat += sp / 2
                if form == 'flank':
                    gap = 2.0 * TILE
                    lat += gap / 2 if c >= cnt / 2 else -gap / 2
                slots.append((gi, lat, back + r * sp))
        back += nrows * sp
    # центр строя — в точке приказа
    mid = back / 2 - sp / 2
    out = []
    for gi, g in enumerate(groups):
        mine = [(lat, b - mid) for (gg, lat, b) in slots if gg == gi]
        out += _match(g, mine, wx, wy, fx, fy, sx, sy)
    return out


def _match(units, slots, wx, wy, fx, fy, sx, sy):
    """Юниты группы → её места: передние юниты — в передний ряд, внутри ряда — по боковой координате,
    чтобы пути не перекрещивались."""
    rows = {}
    for lat, bk in slots:
        rows.setdefault(round(bk, 3), []).append((lat, bk))
    rest = sorted(units, key=lambda u: -((u.x - wx) * fx + (u.y - wy) * fy))
    out = []
    for key in sorted(rows):
        row = sorted(rows[key])
        take, rest = rest[:len(row)], rest[len(row):]
        take.sort(key=lambda u: (u.x - wx) * sx + (u.y - wy) * sy)
        for u, (lat, bk) in zip(take, row):
            out.append((u, wx + sx * lat - fx * bk, wy + sy * lat - fy * bk))
    return out


def _assign(slots, wx, wy, fx, fy, sx, sy):
    return [(u, wx + sx * lat - fx * bk, wy + sy * lat - fy * bk) for (u, lat, bk) in slots]


def group_speed(units):
    """Скорость строя — по самому медленному (px/с)."""
    return min(u.speed() for u in units) if units else None


# ============================================================ точки сбора
def rally_order(w, u, r):
    """Новый юнит выполняет точку сбора r: земля / ресурс / стройка / ферма / гарнизон / враг / здание."""
    from .world import Building, Node
    from . import defense
    if r is None:
        return
    if isinstance(r, tuple):
        u.cmd_move(*r)
        return
    if not r.alive:
        return
    kind = u.kind
    if isinstance(r, Node) and kind == 'villager':
        u.cmd_gather(r)
    elif isinstance(r, Building) and r.owner == u.owner:
        if not r.complete and kind == 'villager':
            u.cmd_build(r)
        elif r.kind == 'farm' and kind == 'villager':
            u.cmd_gather(r)
        elif defense.capacity(r) > 0 and u.cls in r.d.get('garrison_cls', ('vil', 'inf', 'arch')):
            u.cmd_garrison(r)
        elif kind == 'villager' and repairable(u, r):
            cmd_repair(u, r)
        else:
            u.cmd_move(*r.center())
    elif getattr(r, 'owner', -1) >= 0 and w.hostile(r.owner, u.owner):
        u.cmd_attack(r)
    else:
        u.cmd_move(*r.center())


def apply_rally(w, b, u):
    """World.spawn: новый юнит идёт по точкам сбора здания b (несколько — DE, Shift+ПКМ)."""
    r = b.rally
    if r is None:
        return
    pts = getattr(b, 'rally_pts', None)
    if pts:
        u.cmd_move(*pts[0])
        u.orders = [('move', x, y) for (x, y) in pts[1:]] + [('rally', r)]
    else:
        rally_order(w, u, r)
