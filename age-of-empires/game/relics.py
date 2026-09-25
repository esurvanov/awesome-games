"""Реликвии (как в AoE II DE): лежат на карте ничьими, их нельзя уничтожить. Монах поднимает реликвию
(пока несёт — не лечит и не обращает), относит в свой монастырь; каждая реликвия в монастыре приносит
владельцу 0.5 золота в игровую секунду. Монах погиб — реликвия падает на землю; монастырь разрушен —
реликвии выпадают вокруг него. Победа по реликвиям не включена.

API:
  spawn(w, tx, ty)            — положить реликвию на клетку (или ближайшую свободную); → Relic
  on_ground(w)                — реликвии на земле
  held(w, b)                  — сколько реликвий в здании b
  cmd_pick(u, w, r)           — монах: поднять реликвию r (приказ orders 'relic')
  cmd_deposit(u, w, b)        — монах с реликвией: отнести в монастырь b (приказ orders 'relic_in')
  tick(w, dt)                 — доход, выпадение, простая логика ИИ (WORLD_HOOKS['tick'])
  draw_ground / draw_carried  — отрисовка (game/ui.py); panel — строка в панели монастыря
Состояние мира: w.relics — список Relic (есть у мира после первого spawn; getattr(w, 'relics', ())).
"""
import math

from .data import TILE, UNITS, BUILDINGS, WORLD_HOOKS

GOLD_PER_S = 0.5            # AoE2 DE: золота в игровую секунду на реликвию
AI_T = 3.0                  # ИИ думает о реликвиях раз в столько секунд
AI_LEVEL = 2                # с какого уровня ИИ (0…5) монахи собирают реликвии
REACH = 6                   # px: монах берёт реликвию, подойдя вплотную


class Relic:
    """Реликвия. На земле — carrier и holder None; у монаха — carrier; в монастыре — holder."""
    kind = 'relic'
    owner = -1
    w = h = 1
    is_relic = True

    def __init__(self, x, y):
        self.x, self.y = x, y
        self.carrier = None
        self.holder = None
        self.alive = True
        self.var = int(x * 7 + y * 13) & 0xff

    @property
    def tx(self):
        return int(self.x // TILE)

    @property
    def ty(self):
        return int(self.y // TILE)

    def center(self):
        return self.x, self.y

    @property
    def free(self):
        return self.carrier is None and self.holder is None


def _list(w):
    lst = w.__dict__.get('relics')
    if lst is None:
        lst = w.relics = []
    return lst


def spawn(w, tx, ty):
    """Реликвия на клетке (tx, ty); если клетка занята/непроходима — на ближайшей свободной."""
    if not w.passable(tx, ty) or w.occ[ty][tx] is not None:
        tx, ty = w.nearest_free_tile(tx, ty)
    r = Relic((tx + 0.5) * TILE, (ty + 0.5) * TILE)
    _list(w).append(r)
    return r


def on_ground(w):
    return [r for r in getattr(w, 'relics', ()) if r.free]


def held(w, b):
    return sum(1 for r in getattr(w, 'relics', ()) if r.holder is b)


def _monastery_ok(u, b):
    return b is not None and b.alive and b.kind == 'monastery' and b.complete and b.owner == u.owner


# ============================================================ приказы монаха
def cmd_pick(u, w, r):
    if not u.d.get('monk') or u.relic is not None or r is None or not r.free:
        return False
    u.release()
    u.state = 'relic_pick'
    u.target = r
    u.path_target = None
    u.path = []
    return True


def cmd_deposit(u, w, b):
    if u.relic is None or not _monastery_ok(u, b):
        return False
    u.release()
    u.state = 'relic_in'
    u.target = b
    u.path_target = None
    u.path = []
    return True


def _st_pick(u, w, dt):
    r = u.target
    if r is None or not isinstance(r, Relic) or not r.free or u.relic is not None:
        u.state, u.target = 'idle', None
        return
    if u.approach(w, r, REACH, dt):
        r.carrier = u
        u.relic = r
        r.x, r.y = u.x, u.y
        u.state, u.target = 'idle', None
        if u.owner == w.human:
            w.msg('Монах поднял реликвию — отнесите её в монастырь', (255, 230, 150))
        # сразу к ближайшему своему монастырю, если он есть (как делает DE при приказе с Shift — упрощённо)
        b = nearest_monastery(w, u)
        if b is not None and u.owner != w.human:
            cmd_deposit(u, w, b)


def _st_deposit(u, w, dt):
    b = u.target
    r = u.relic
    if r is None or not _monastery_ok(u, b):
        u.state, u.target = 'idle', None
        return
    if u.approach(w, b, 0.5 * TILE, dt):
        r.carrier = None
        r.holder = b
        cx, cy = b.center()
        r.x, r.y = cx, cy
        u.relic = None
        u.state, u.target = 'idle', None
        if b.owner == w.human:
            w.msg(f'Реликвия в монастыре: +{GOLD_PER_S:g} золота/с', (255, 230, 150))


def nearest_monastery(w, u):
    best, bd = None, 1e18
    for b in w.buildings:
        if _monastery_ok(u, b):
            d = u.dist_to(b)
            if d < bd:
                bd, best = d, b
    return best


# ============================================================ мир
def _drop(w, r, x, y, k=0):
    """Положить реликвию на землю у точки (x, y) px; k — номер при выпадении нескольких (разнести)."""
    tx, ty = int(x // TILE), int(y // TILE)
    if k:
        a = k * 2.39996
        tx += int(round(math.cos(a) * (1 + k * 0.4)))
        ty += int(round(math.sin(a) * (1 + k * 0.4)))
    tx = max(0, min(w.W - 1, tx))
    ty = max(0, min(w.H - 1, ty))
    if not w.passable(tx, ty):
        tx, ty = w.nearest_free_tile(tx, ty)
    r.carrier = None
    r.holder = None
    r.x, r.y = (tx + 0.5) * TILE, (ty + 0.5) * TILE


def tick(w, dt):
    lst = w.__dict__.get('relics')
    if not lst:
        return
    players = w.players
    out = {}
    for r in lst:
        c = r.carrier
        if c is not None:
            if c.alive or c.inside is not None:
                r.x, r.y = c.x, c.y
                if c.relic is not r:        # монаха обратили/сбросили состояние — вернуть связь
                    c.relic = r
            else:
                _drop(w, r, c.x, c.y)       # монах погиб — реликвия на земле
                c.relic = None
            continue
        b = r.holder
        if b is not None:
            if not b.alive:
                k = out[id(b)] = out.get(id(b), -1) + 1
                cx, cy = b.center()
                _drop(w, r, cx, cy + (b.h / 2 + 0.6) * TILE, k)
            elif 0 <= b.owner < len(players):
                players[b.owner].res['gold'] += GOLD_PER_S * dt
    # ИИ: один свободный монах идёт за ближайшей реликвией, монах с реликвией — в монастырь
    t = w.__dict__.get('_relic_ai_t', 0.0) - dt
    if t <= 0:
        t = AI_T
        _ai(w)
    w._relic_ai_t = t


def _ai(w):
    ais = getattr(w, 'ais', None)
    if not ais:
        return
    ground = on_ground(w)
    for ai in ais:
        if getattr(ai, 'level', 0) < AI_LEVEL:
            continue
        pid = ai.pid
        monks = [u for u in w.units if u.owner == pid and u.alive and u.d.get('monk')]
        if not monks:
            continue
        home = None
        for u in monks:
            if u.relic is not None and u.state != 'relic_in':
                home = home or nearest_monastery(w, u)
                if home is not None:
                    cmd_deposit(u, w, home)
        if not ground or any(u.state == 'relic_pick' for u in monks):
            continue
        idle = [u for u in monks if u.relic is None and u.state == 'idle']
        if not idle or nearest_monastery(w, idle[0]) is None:
            continue
        taken = {id(u.target) for u in w.units if u.state == 'relic_pick'}
        best = None
        for m in idle:
            for r in ground:
                if id(r) in taken:
                    continue
                d = math.hypot(r.x - m.x, r.y - m.y)
                if best is None or d < best[0]:
                    best = (d, m, r)
        if best is not None:
            cmd_pick(best[1], w, best[2])


# ============================================================ отрисовка
def _chest(k=1.0):
    """Процедурная реликвия: золотой ларец на носилках (≈ 22×18 px при k=1)."""
    import pygame
    W, H = int(24 * k) + 2, int(20 * k) + 2
    s = pygame.Surface((W, H), pygame.SRCALPHA)

    def P(x, y):
        return int(x * k) + 1, int(y * k) + 1
    pygame.draw.ellipse(s, (0, 0, 0, 70), (*P(1, 13), int(22 * k), int(6 * k)))
    pygame.draw.line(s, (110, 70, 30), P(0, 13), P(23, 9), max(1, int(2 * k)))
    body = [P(4, 8), P(14, 5), P(20, 8), P(20, 14), P(10, 17), P(4, 14)]
    pygame.draw.polygon(s, (214, 170, 52), body)
    pygame.draw.polygon(s, (170, 124, 30), [P(10, 11), P(20, 8), P(20, 14), P(10, 17)])
    pygame.draw.polygon(s, (250, 220, 110), [P(4, 8), P(14, 5), P(20, 8), P(10, 11)])
    pygame.draw.polygon(s, (90, 60, 20), body, 1)
    pygame.draw.line(s, (255, 245, 190), P(7, 7), P(9, 3), 1)
    pygame.draw.line(s, (255, 245, 190), P(15, 5), P(17, 1), 1)
    return s, W // 2, H - int(4 * k)


_SPR = {}


def sprite(small=False):
    """(surface, ax, ay) — точка (ax, ay) спрайта ставится на землю."""
    key = small
    hit = _SPR.get(key)
    if hit is None:
        got = None
        try:
            from . import map_assets
            got = map_assets.relic()
        except Exception:
            got = None
        if got is not None:
            surf, ox, oy = got
            if small:
                import pygame
                k = 0.6
                surf = pygame.transform.smoothscale(surf, (max(1, int(surf.get_width() * k)),
                                                           max(1, int(surf.get_height() * k))))
                ox, oy = ox * k, oy * k
            # спрайт природы: (ox, oy) — верхний угол ромба клетки; земля — центр ромба (+16)
            hit = (surf, int(ox), int(oy) + 16)
        else:
            hit = _chest(0.7 if small else 1.0)
        _SPR[key] = hit
    return hit


def draw_ground(g, r, sx, sy):
    surf, ax, ay = sprite()
    x, y = int(sx - ax), int(sy - ay)
    g.screen.blit(surf, (x, y))
    import pygame
    g.drawn.append((pygame.Rect(x, y, *surf.get_size()), r, surf))


def draw_carried(g, u, sx, sy):
    surf, ax, ay = sprite(True)
    g.screen.blit(surf, (int(sx - ax + 6), int(sy - ay - 30)))


def panel(g, b, x, y):
    """Строка в панели монастыря: реликвии и доход."""
    n = held(g.world, b)
    if n:
        g.text(f'Реликвии: {n}  (+{n * GOLD_PER_S:g} зол./с)', (x, y), 'bs', (120, 80, 10), anchor='midleft')


# ============================================================ регистрация
def register():
    m = UNITS.get('monk')
    if m is not None:
        st = m.setdefault('states', {})
        st['relic_pick'] = _st_pick
        st['relic_in'] = _st_deposit
    b = BUILDINGS.get('monastery')
    if b is not None and 'panel' not in b:
        b['panel'] = panel
    if tick not in WORLD_HOOKS['tick']:
        WORLD_HOOKS['tick'].append(tick)
