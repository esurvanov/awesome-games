"""Relics (as in AoE II DE): they lie on the map owned by nobody and cannot be destroyed. A monk picks up a relic
(while carrying it - he neither heals nor converts), takes it to his monastery; each relic in a monastery brings its
owner 0.5 gold per game second. The monk died - the relic falls to the ground; the monastery is destroyed -
the relics fall out around it. Relic victory is not enabled.

API:
  spawn(w, tx, ty)            - put a relic on a tile (or the nearest free one); -> Relic
  on_ground(w)                - relics on the ground
  held(w, b)                  - how many relics are in building b
  cmd_pick(u, w, r)           - a monk: pick up relic r (the order orders 'relic')
  cmd_deposit(u, w, b)        - a monk with a relic: carry it to monastery b (the order orders 'relic_in')
  tick(w, dt)                 - income, dropping, simple AI logic (WORLD_HOOKS['tick'])
  draw_ground / draw_carried  - drawing (game/ui.py); panel - a line in the monastery panel
World state: w.relics - a list of Relic (the world has it after the first spawn; getattr(w, 'relics', ())).
"""
import math

from . import i18n
from .data import TILE, UNITS, BUILDINGS, WORLD_HOOKS

GOLD_PER_S = 0.5            # AoE2 DE: gold per game second per relic
AI_T = 3.0                  # the AI thinks about relics once every this many seconds
AI_LEVEL = 2                # from which AI level (0...5) monks collect relics
REACH = 6                   # px: a monk takes a relic once he is right next to it


class Relic:
    """A relic. On the ground - carrier and holder are None; with a monk - carrier; in a monastery - holder."""
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
    """A relic on tile (tx, ty); if the tile is occupied/impassable - on the nearest free one."""
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


# ============================================================ monk orders
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
            w.msg(i18n.t('msg.relic_picked'), (255, 230, 150))
        # straight to the nearest own monastery, if there is one (as DE does on a Shift order - simplified)
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
            w.msg(i18n.t('msg.relic_stored', n=f'{GOLD_PER_S:g}'), (255, 230, 150))


def nearest_monastery(w, u):
    best, bd = None, 1e18
    for b in w.buildings:
        if _monastery_ok(u, b):
            d = u.dist_to(b)
            if d < bd:
                bd, best = d, b
    return best


# ============================================================ world
def _drop(w, r, x, y, k=0):
    """Put a relic on the ground at the point (x, y) px; k - a number when several fall out (to spread them)."""
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
                if c.relic is not r:        # the monk was converted/reset its state - restore the link
                    c.relic = r
            else:
                _drop(w, r, c.x, c.y)       # the monk died - the relic is on the ground
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
    # AI: one free monk goes for the nearest relic, a monk with a relic - to the monastery
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


# ============================================================ drawing
def _chest(k=1.0):
    """A procedural relic: a golden casket on a litter (~ 22x18 px at k=1)."""
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
    """(surface, ax, ay) - the point (ax, ay) of the sprite is placed on the ground."""
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
            # a nature sprite: (ox, oy) - the top corner of the tile's diamond; the ground - the center of the diamond (+16)
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
    """A line in the monastery panel: relics and income."""
    n = held(g.world, b)
    if n:
        g.text(i18n.t('relic.panel', n=n, gold=f'{n * GOLD_PER_S:g}'), (x, y), 'bs', (120, 80, 10), anchor='midleft')


# ============================================================ registration
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
