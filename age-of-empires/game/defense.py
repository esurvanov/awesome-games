"""Defense: walls (lines of segments), gates, garrison, town bell, wall breaching, tower upgrades.

Simulation logic without graphics; world.py calls hooks from here, the interface and AI use the API below.

Walls and gates are ordinary buildings (BUILDINGS[...]['wall'] = True; gates also have 'gate' = True).
  line_tiles(x0, y0, x1, y1)                    - tiles of a straight/diagonal line (like dragging in the original)
  place_wall_line(w, kind, pid, x0, y0, x1, y1, builders)  - foundations along the line, paid per segment
  gate_rect(tx, ty, horiz, span)  /  can_place_gate(...)  /  place_gate(...)  - a 4x1 or 1x4 gate;
      placed on free ground or over own walls (segments are replaced)
  Passability by owner: World.passable_for(x, y, owner), World.find_path(..., owner=...) -
      gate tiles are passable only for the owner and allies (grid World.gate).
Garrison (rules of the original): BUILDINGS[k]['garrison'] - capacity, ['garrison_cls'] - unit classes.
  can_garrison(b, u) / Unit.cmd_garrison(b) / enter(w, u, b) / eject(w, b, units=None)
  A unit inside: u.inside = the building, u.alive = False (it disappears from the map but counts toward the population), heals,
  villagers and ranged units give the building +1 arrow. When the building is destroyed everyone comes out.
Town bell: ring_bell(w, pid) - all villagers into the nearest buildings with room; all_clear(w, pid) - back to their tasks.
Breach: breach_target(w, u, ent) - if the path to the target is blocked by enemy walls, the nearest blocking segment.
Towers: upgrade_buildings(w, p, old, new) - all buildings old -> new (keeping the HP share), new ones are built as new.
"""
import math
import random

from . import i18n
from .data import TILE, BUILDINGS
from .world import Building

GARRISON_HEAL = 0.5          # HP per game second for those sitting in a garrison
ARROW_CLS = ('vil', 'arch')  # whoever is in the garrison adds an arrow


def is_wall(b):
    return isinstance(b, Building) and b.d.get('wall', False)


def is_gate(b):
    return isinstance(b, Building) and b.d.get('gate', False)


# ============================================================ walls
def line_tiles(x0, y0, x1, y1):
    """Tiles of the line from (x0, y0) to (x1, y1) (8-connected, without gaps: diagonal joints are impassable)."""
    pts = []
    n = max(abs(x1 - x0), abs(y1 - y0))
    for i in range(n + 1):
        t = i / n if n else 0.0
        pts.append((int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))))
    out = []
    for p in pts:
        if not out or out[-1] != p:
            out.append(p)
    return out


def wall_plan(w, kind, pid, tiles):
    """Which tiles of the line can be built on (occupied ones are skipped)."""
    return [(x, y) for x, y in tiles if w.can_place(kind, x, y, pid)]


def place_wall_line(w, kind, pid, x0, y0, x1, y1, builders=()):
    """Lay a wall along a line. Pays for each segment while resources last.
    Builders go to the nearest segments and then build along the chain (the nearest next one).
    Returns the list of laid segments."""
    p = w.players[pid]
    placed = []
    for x, y in wall_plan(w, kind, pid, line_tiles(x0, y0, x1, y1)):
        if not p.pay(p.cost_of('bld', kind)):
            if pid == w.human:
                w.msg(i18n.t('msg.not_enough_resources'), (255, 150, 90))
            break
        placed.append(w.place_building(kind, pid, x, y))
    assign_builders(placed, builders)
    return placed


def assign_builders(segs, builders):
    """To each builder - the segment nearest to it (evenly), then the chain in Unit.after_build."""
    segs = [s for s in segs if s.alive]
    if not segs:
        return
    load = {id(s): 0 for s in segs}
    for u in builders:
        if u.kind != 'villager':
            continue
        s = min(segs, key=lambda s: (load[id(s)], u.dist_to(s)))
        load[id(s)] += 1
        u.cmd_build(s)


# ============================================================ gates
def gate_rect(tx, ty, horiz, span=4):
    """(x, y, width, height) of a gate: horiz - along the x axis."""
    return (tx, ty, span, 1) if horiz else (tx, ty, 1, span)


def gate_span(kind):
    return BUILDINGS[kind].get('span', 4)


def can_place_gate(w, kind, tx, ty, horiz, pid, check_explored=True):
    """A gate can be placed on free ground and over own walls (not gates)."""
    x0, y0, gw, gh = gate_rect(tx, ty, horiz, gate_span(kind))
    for y in range(y0, y0 + gh):
        for x in range(x0, x0 + gw):
            if not (0 <= x < w.W and 0 <= y < w.H):
                return False
            if w.terrain[y][x] != 0 or w.floor[y][x] is not None:
                return False
            o = w.occ[y][x]
            if o is not None and not (is_wall(o) and not is_gate(o) and o.owner == pid):
                return False
            if pid == w.human and check_explored and not w.explored[y * w.W + x]:
                return False
    for u in w.units:
        if u.owner != pid and x0 * TILE - 4 <= u.x <= (x0 + gw) * TILE + 4 and \
                y0 * TILE - 4 <= u.y <= (y0 + gh) * TILE + 4:
            return False
    return True


def gate_orient(w, kind, tx, ty, pid, prefer=True):
    """Gate orientation at a point: along its own wall if there is one; otherwise prefer."""
    span = gate_span(kind)
    best = None
    for horiz in (prefer, not prefer):
        x0, y0, gw, gh = gate_rect(tx, ty, horiz, span)
        walls = sum(1 for y in range(y0, y0 + gh) for x in range(x0, x0 + gw)
                    if 0 <= x < w.W and 0 <= y < w.H and is_wall(w.occ[y][x]) and w.occ[y][x].owner == pid)
        if best is None or walls > best[0]:
            best = (walls, horiz)
    return best[1]


def place_gate(w, kind, pid, tx, ty, horiz, builders=(), pay=True):
    """Lay a gate (the own wall segments under it are demolished). None - impossible/not enough resources."""
    p = w.players[pid]
    if not can_place_gate(w, kind, tx, ty, horiz, pid):
        return None
    if pay and not p.pay(p.cost_of('bld', kind)):
        return None
    x0, y0, gw, gh = gate_rect(tx, ty, horiz, gate_span(kind))
    old = []
    for y in range(y0, y0 + gh):
        for x in range(x0, x0 + gw):
            o = w.occ[y][x]
            if is_wall(o):
                old.append(o)
    for o in old:
        w.remove_building(o, rubble=False)
    b = w.place_building(kind, pid, x0, y0, size=(gw, gh))
    for u in builders:
        if u.kind == 'villager':
            u.cmd_build(b)
    return b


def gate_open(w, b):
    """Whether a gate is open: an own/allied unit is nearby (for drawing only)."""
    if not b.complete:
        return False
    x0, y0 = (b.tx - 1) * TILE, (b.ty - 1) * TILE
    x1, y1 = (b.tx + b.w + 1) * TILE, (b.ty + b.h + 1) * TILE
    arow = w.amat[b.owner]
    for u in w.units:
        if x0 <= u.x <= x1 and y0 <= u.y <= y1 and arow[u.owner]:
            return True
    return False


def wall_mask(w, b):
    """Mask of neighboring walls (for neat joints): bits by the DIR8 directions."""
    return mask_at(w, b.tx, b.ty, b.owner, exclude=b)


def mask_at(w, x0, y0, owner, extra=(), exclude=None):
    """Mask of connections of the tile (x0, y0) with own walls/gates and the extra tiles (the line's ghost).
    A diagonal connects only if there is no corner path through the straight neighbors."""
    occ = w.occ

    def wall(x, y):
        if (x, y) in extra:
            return True
        if 0 <= x < w.W and 0 <= y < w.H:
            o = occ[y][x]
            return o is not None and o is not exclude and is_wall(o) and o.owner == owner
        return False

    m = 0
    for i, (dx, dy) in enumerate(DIR8):
        if wall(x0 + dx, y0 + dy):
            if dx and dy and (wall(x0 + dx, y0) or wall(x0, y0 + dy)):
                continue
            m |= 1 << i
    return m


DIR8 = [(1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (-1, 1), (-1, -1), (1, -1)]


# ============================================================ breach
def breach_target(w, u, ent):
    """No path to ent found: the enemy wall/gate segment near the end of the path, nearest to the target."""
    if is_wall(ent) or not w.hostile(u.owner, ent.owner):
        return None
    if u.path:
        ex, ey = u.path[-1]
    else:
        ex, ey = u.tile()
    cx, cy = ent.center()
    best, bd = None, 1e18
    hrow = w.hmat[u.owner]
    seen = set()
    for y in range(ey - 3, ey + 4):
        for x in range(ex - 3, ex + 4):
            if 0 <= x < w.W and 0 <= y < w.H:
                o = w.occ[y][x]
                if o is None or id(o) in seen or not is_wall(o) or not hrow[o.owner]:
                    continue
                seen.add(id(o))
                ox, oy = o.center()
                d = math.hypot(ox - cx, oy - cy) + 0.5 * math.hypot(ox - u.x, oy - u.y)
                if d < bd:
                    bd, best = d, o
    return best


# ============================================================ garrison
def capacity(b):
    return b.d.get('garrison', 0) if b.complete else 0


def can_garrison(b, u):
    """Whether unit u may enter building b (own, completed, has room, a suitable class)."""
    return (b.alive and b.complete and b.owner == u.owner and len(b.garrison) < capacity(b)
            and u.cls in b.d.get('garrison_cls', ('vil', 'inf', 'arch')))


def enter(w, u, b):
    """A unit enters a building: it disappears from the map (alive=False) but stays in the population."""
    u.release()
    u.inside = b
    u.alive = False
    u.state = 'idle'
    u.target = None
    u.path = []
    u.dest = None
    u.pending = None
    b.garrison.append(u)
    cx, cy = b.center()
    w.emit('garrison', cx, cy, b.owner, u.kind)


def do_garrison(w, u, dt):
    """The 'garrison' unit state: walk to the building and enter."""
    b = u.target
    if b is None or not can_garrison(b, u):
        u.state = 'idle'
        u.target = None
        return
    if u.approach(w, b, 12, dt):
        enter(w, u, b)


def exit_tiles(w, b, n, owner):
    """Up to n free tiles around the building (nearest to the "facade" first)."""
    out = []
    for r in range(1, 6):
        ring = []
        for y in range(b.ty - r, b.ty + b.h + r):
            for x in range(b.tx - r, b.tx + b.w + r):
                if b.tx - r < x < b.tx + b.w + r - 1 and b.ty - r < y < b.ty + b.h + r - 1:
                    continue
                if w.passable(x, y):
                    ring.append((-(y - b.ty) - (x - b.tx) * 0.5, x, y))
        ring.sort()
        out += [(x, y) for _, x, y in ring]
        if len(out) >= n:
            break
    return out or [w.nearest_free_tile(b.tx + b.w // 2, b.ty + b.h)]


def eject(w, b, units=None, rally=True):
    """Eject the garrison (all or the list units) around the building. Returns the ejected units."""
    units = list(b.garrison if units is None else units)
    if not units:
        return []
    tiles = exit_tiles(w, b, len(units), b.owner)
    out = []
    for i, u in enumerate(units):
        if u not in b.garrison:
            continue
        b.garrison.remove(u)
        tx, ty = tiles[i % len(tiles)]
        u.x = (tx + 0.5) * TILE + random.uniform(-5, 5)
        u.y = (ty + 0.5) * TILE + random.uniform(-5, 5)
        u.inside = None
        u.alive = True
        u.state = 'idle'
        u.target = None
        u.path = []
        u.path_target = None
        w.units.append(u)
        out.append(u)
        if rally and b.alive and isinstance(b.rally, tuple):
            u.cmd_move(*b.rally)
    cx, cy = b.center()
    w.emit('eject', cx, cy, b.owner, len(out))
    return out


def tick_garrison(w, b, dt):
    """Healing of those sitting inside (slowly, as in the original)."""
    for u in b.garrison:
        if u.hp < u.max_hp:
            u.hp = min(float(u.max_hp), u.hp + GARRISON_HEAL * dt)


def bonus_arrows(b):
    """+1 arrow for each villager or ranged unit in the garrison."""
    if not b.garrison:
        return 0
    return sum(1 for u in b.garrison if u.cls in ARROW_CLS)


def garrison_buildings(w, pid, cls='vil'):
    return [b for b in w.buildings if b.owner == pid and b.alive and b.complete and capacity(b) > 0
            and cls in b.d.get('garrison_cls', ('vil', 'inf', 'arch'))]


# ============================================================ town bell
def snapshot(u):
    """Remember a villager's task so as to restore it after "All clear"."""
    st = u.state
    if st in ('gather', 'return') and u.gather_kind:
        return ('gather', u.target, u.gather_kind)
    if st == 'build' and u.target is not None:
        return ('build', u.target, None)
    return ('pos', (u.x, u.y), None)


def ring_bell(w, pid):
    """Town bell: all of the player's villagers run to the nearest buildings with room (center, towers, castle)."""
    p = w.players[pid]
    p.bell = True
    blds = garrison_buildings(w, pid)
    room = {id(b): capacity(b) - len(b.garrison) for b in blds}
    vils = [u for u in w.units if u.owner == pid and u.kind == 'villager' and u.alive]
    n = 0
    for u in vils:
        if getattr(u, 'bell_task', None) is None:
            u.bell_task = snapshot(u)
        cands = [b for b in blds if room[id(b)] > 0]
        if not cands:
            continue
        # the center takes priority if it is not much farther
        b = min(cands, key=lambda b: u.dist_to(b) * (0.7 if b.kind == 'town_center' else 1.0))
        room[id(b)] -= 1
        u.cmd_garrison(b)
        n += 1
    if blds:
        cx, cy = blds[0].center()
    else:
        cx, cy = w.starts[pid][0] * TILE, w.starts[pid][1] * TILE
    w.emit('bell', cx, cy, pid, n)
    if pid == w.human:
        w.msg(i18n.t('msg.bell'), (255, 200, 110))
    return n


def all_clear(w, pid):
    """'All clear': villagers come out and return to their previous tasks."""
    p = w.players[pid]
    p.bell = False
    back = []
    for b in list(w.buildings):
        if b.owner == pid and b.garrison:
            vs = [u for u in b.garrison if u.kind == 'villager' and getattr(u, 'bell_task', None) is not None]
            back += eject(w, b, vs, rally=False)
    for u in w.units:
        if u.owner == pid and u.kind == 'villager' and getattr(u, 'bell_task', None) is not None:
            if u not in back:
                back.append(u)
    for u in back:
        restore(w, u)
    if pid == w.human:
        w.msg(i18n.t('msg.all_clear'), (170, 230, 150))
    return len(back)


def restore(w, u):
    task, u.bell_task = u.bell_task, None
    if task is None:
        return
    kind, t, extra = task
    if kind == 'gather':
        if t is not None and u.gather_target_valid(t):
            u.cmd_gather(t)
            return
        nt = w.find_resource(u, extra, u.x, u.y, 14)
        if nt is not None:
            u.cmd_gather(nt)
            return
        u.gather_kind = extra
        u.state = 'idle'
    elif kind == 'build':
        if t.alive and not t.complete:
            u.cmd_build(t)
    else:
        u.cmd_move(*t)


# ============================================================ towers
def upgrade_buildings(w, p, old, new):
    """All buildings old of player p -> new (the HP share is kept), later ones are built as new right away."""
    for k, v in list(p.alias.items()):
        if v == old:
            p.alias[k] = new
    p.alias[old] = new
    d = BUILDINGS[new]
    for b in w.buildings:
        if b.owner == p.id and b.kind == old and b.alive:
            frac = b.hp / b.max_hp if b.max_hp else 1.0
            b.kind = new
            b.d = d
            b.max_hp = p.stat('hp', new, d['hp'])
            b.hp = max(1.0, b.max_hp * frac)
            cx, cy = b.center()
            w.emit('upgrade', cx, cy, p.id, new)


def building_upgrade(old, new):
    """For techs: TECHS[...]['on_apply'] = building_upgrade('tower', 'guard_tower')."""
    def apply(w, p):
        upgrade_buildings(w, p, old, new)
    return apply
