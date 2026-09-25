"""Simulation: players, resources, buildings, units, projectiles, the map."""
import heapq
import math
import random

from .data import (TILE, MAP_SIZES, RES, START_RES, PLAYER_COLORS, PLAYER_NAMES, AGE_NAMES, NODE_DEFS,
                   FARM_RATE, FARM_FOOD, CARRY, ANIMALS, UNITS, BUILDINGS, BUILDING_ARMOR, TECHS, AGE_TECHS, AGE_REQ,
                   CIVS, WORLD_HOOKS, as_tuple)
from . import i18n
from . import match
from . import terrain
from . import stats as gstats


# ============================================================ player
_TAGS = {}


def unit_tags(kind):
    """Armor classes of a unit/building: the main cls + extra ones from 'ac' (see data.py, "armor classes")."""
    t = _TAGS.get(kind)
    if t is None:
        d = UNITS.get(kind) or BUILDINGS.get(kind)
        if d is None:
            return ()
        base = (d['cls'],) if kind in UNITS else ('bld',)
        t = _TAGS[kind] = base + tuple(c for c in d.get('ac', ()) if c not in base)
    return t


def _entity_cls(kind):
    """Classes for modifier filters: units - cls + 'ac' from UNITS, buildings - 'bld' (+ 'ac'),
    techs - 'tech'. Always a tuple."""
    if kind in UNITS or kind in BUILDINGS:
        return unit_tags(kind)
    if kind in TECHS:
        return ('tech',)
    return ()


_BONUS_KEY = {}


def _bonus_key(c):
    """The name of the stat modifier of the bonus against class c: 'bonus:cav' and so on."""
    k = _BONUS_KEY[c] = 'bonus:' + c
    return k


def _hit(c, tags):
    for x in as_tuple(c):
        if x in tags:
            return True
    return False


def _matches(e, kind, cls, res, src):
    k = e.get('kind')
    if k is not None and kind not in as_tuple(k):
        return False
    c = e.get('cls')
    if c is not None and not _hit(c, cls):
        return False
    c = e.get('not_cls')
    if c is not None and _hit(c, cls):
        return False
    r = e.get('res')
    if r is not None and res not in as_tuple(r):
        return False
    r = e.get('src')
    if r is not None and src not in as_tuple(r):
        return False
    return True


_BANS = {}


def civ_bans(civ, full=False):
    """What is unavailable to a civilization: its 'disabled', other civilizations' unique items ('civ' in the entry), the
    (building, unit) pairs from 'banned_at'; plus everything that depends on the unavailable (line upgrades, req chains).
    full=True - the "full tech tree" (lobby): only other civilizations' unique items."""
    b = _BANS.get((civ, full))
    if b is None:
        c = CIVS.get(civ, CIVS['default'])
        b = set() if full else set(c.get('disabled', ())) | set(c.get('banned_at', ()))
        for tab in (UNITS, TECHS, BUILDINGS):
            b |= {k for k, d in tab.items() if d.get('civ') not in (None, civ)}
        grow = True
        while grow:
            grow = False
            for k, d in TECHS.items():
                if k in b:
                    continue
                up = d.get('upgrade')
                if (up and (up[0] in b or up[1] in b)) or any(r in b for r in as_tuple(d.get('req', ()))):
                    b.add(k)
                    if up:
                        b.add(up[1])
                    grow = True
            for k, d in UNITS.items():
                if k not in b and any(r in b for r in as_tuple(d.get('req', ()))):
                    b.add(k)
                    grow = True
        b = _BANS[(civ, full)] = frozenset(b)
    return set(b)


class Player:
    @property
    def name(self):
        key = self.__dict__.get('name_key')
        if key:
            return i18n.t(key)
        return self.__dict__.get('_name') or self.__dict__.get('name') or ''

    @name.setter
    def name(self, v):
        self.name_key = None
        self._name = v

    def __init__(self, pid, team=None, name=None, color=None, is_ai=False, civ='default'):
        self.id = pid
        self.team = pid if team is None else team
        # name: as given, otherwise a locale key ("You" / color) - translated on display (language change, saves)
        self.name_key = None if name else ('player.you' if pid == 0 else 'color.' + i18n.COLOR_KEYS[pid % 8])
        self._name = name or PLAYER_NAMES[pid]
        self.color = color or PLAYER_COLORS[pid]
        self.is_ai = is_ai
        self.alive = True           # False - defeated (no center and no villagers)
        self.res = dict(START_RES)
        self.age = 0
        self.techs = set()
        self.researching = set()
        self.pop = 0
        self.cap = 0
        self.gathered = {k: 0.0 for k in RES}
        self.kills = 0
        self.kill_value = 0         # the cost of what was killed and destroyed (the military score)
        self.effects = []           # all active modifiers (techs + civilization + difficulty)
        self._mc = {}               # cache (stat, kind, res, src) -> (add, mul)
        self.ver = 0                # grows on every change of effects (a key for the stat caches)
        self.alias = {}             # upgrade lines: base kind -> current (militia -> man_at_arms)
        self.banned = set()         # what is unavailable to the civilization: kinds of units/techs/buildings, (building, unit)
        self.pop_bonus = 0          # + to the population cap (and to the ceiling of 200)
        self.pop_keep = 0           # + to the cap without raising the ceiling ("Nomads": the population of destroyed houses)
        self.pop_extra = {}         # building -> extra population (the center for some civilizations)
        self.civ = None
        self.set_civ(civ)

    @property
    def defeated(self):
        return not self.alive

    # ---- modifiers
    def set_civ(self, civ):
        """A civilization = permanent effects from the start of the match (CIVS in data.py), starting resources,
        unavailable units/techs ('disabled' + other civilizations' unique items, see civ_bans).
        'random' (or unknown) - a random one from the available."""
        if civ not in CIVS or civ == 'random':
            civ = random.choice([k for k in CIVS if k != 'default'] or ['default'])
        self.civ = civ
        c = CIVS[civ]
        self.add_effects(c['effects'])
        self.banned = civ_bans(civ)
        for r, v in c.get('start', {}).items():
            self.res[r] += v
        self.pop_extra = dict(c.get('pop_extra', {}))

    def allows(self, name, where=None):
        """Whether the kind/tech name is available to the civilization (where - the building where it is trained)."""
        return name not in self.banned and (where is None or (where, name) not in self.banned)

    def add_effects(self, effects):
        if effects:
            self.effects.extend(effects)
            self._mc.clear()
            self.ver += 1

    def mod(self, stat, kind=None, res=None, src=None, cls=None):
        """(the sum of add, the product of mul) of all the player's effects for the given stat and entity.
        cls is taken from the tables by kind by default."""
        key = (stat, kind, res, src, cls)
        m = self._mc.get(key)
        if m is None:
            if cls is None:
                cls = _entity_cls(kind)
            elif isinstance(cls, str):
                cls = unit_tags(kind) if kind in UNITS and cls == UNITS[kind]['cls'] else (cls,)
            add, mul = 0, 1
            for e in self.effects:
                if e['stat'] == stat and _matches(e, kind, cls, res, src):
                    add += e.get('add', 0)
                    mul *= e.get('mul', 1)
            m = self._mc[key] = (add, mul)
        return m

    def stat(self, stat, kind, base, res=None, src=None):
        """The final value: (base + add) x mul."""
        m = self._mc.get((stat, kind, res, src, None))
        add, mul = m if m is not None else self.mod(stat, kind, res, src)
        v = base + add
        return v if mul == 1 else v * mul

    def current(self, kind):
        """The unit's current kind taking the researched line upgrades into account."""
        return self.alias.get(kind, kind)

    def cost_of(self, cat, name):
        """The cost taking 'cost' effects into account. cat: 'unit' | 'bld' | 'tech' (as in the buildings' queue)."""
        key = ('cost!', cat, name)
        c = self._mc.get(key)
        if c is None:
            base = (UNITS if cat == 'unit' else BUILDINGS if cat == 'bld' else TECHS)[name]['cost']
            cls = UNITS[name]['cls'] if cat == 'unit' else cat
            c = {}
            for r, v in base.items():
                add, mul = self.mod('cost', name, r, cls=cls)
                c[r] = max(0, int(round((v + add) * mul)))
            self._mc[key] = c
        return c

    def time_of(self, cat, name):
        base = (UNITS if cat == 'unit' else BUILDINGS if cat == 'bld' else TECHS)[name]['time']
        add, mul = self.mod('time', name, cls=UNITS[name]['cls'] if cat == 'unit' else cat)
        return (base + add) * mul

    # ---- resources
    def afford(self, cost, reserve=None):
        for k, v in cost.items():
            if self.res[k] - (reserve or {}).get(k, 0) < v:
                return False
        return True

    def pay(self, cost):
        if not self.afford(cost):
            return False
        for k, v in cost.items():
            self.res[k] -= v
        return True

    def refund(self, cost):
        for k, v in cost.items():
            self.res[k] += v


_hypot = math.hypot

# the unit grid (World.units_in_rect): the cell size, the margin for a per-step shift, the largest unit radius
UG_CELL = 8 * TILE
UG_PAD = TILE
UG_MAXR = 24

_FOG_SPANS = {}                 # sight radius -> [(dy, the row's half-width)] for update_fog
_ONES = b'\x01' * 1024

# the sound of a villager's work by gather source (the 'work' event)
# how many seconds traces lie on the ground (AoE II DE: a body ~ 300 s, rubble 60 s - docs/research/04_graphics.md, 39-40)
DECAL_LIFE = {'body': 300.0, 'rubble': 60.0, 'stump': 60.0}
WORK_SOUND = {'tree': 'chop', 'gold': 'mine', 'stone': 'mine', 'farm': 'farm', 'berries': 'forage', 'hunt': 'butcher'}


# ============================================================ entities
class Node:
    """A resource on the map: a tree, gold, stone, berries."""
    owner = -1
    serial = 0          # how many nodes were created (the "nearest resource" caches are reset when new ones appear)

    def __init__(self, kind, tx, ty):
        Node.serial += 1
        self.kind = kind
        self.tx, self.ty = tx, ty
        self.w = self.h = 1
        self.amount = NODE_DEFS[kind]['amount']
        self.max_amount = self.amount
        self.res = NODE_DEFS[kind]['res']
        self.var = random.randrange(6)
        self.alive = True

    def center(self):
        return (self.tx + 0.5) * TILE, (self.ty + 0.5) * TILE


class Building:
    cls = 'bld'

    def __init__(self, kind, owner, tx, ty, complete=False, player=None):
        d = BUILDINGS[kind]
        self.d = d
        self.kind = kind
        self.owner = owner
        self.p = player
        self.tx, self.ty = tx, ty
        self.w = self.h = d['size']
        self.max_hp = player.stat('hp', kind, d['hp']) if player else d['hp']
        self.progress = 1.0 if complete else 0.0
        self.hp = self.max_hp if complete else 1.0
        self.queue = []
        self.qt = 0.0
        self.housed = False
        self.rally = None
        self.builders = 0
        self.cool = 0.0
        self.target = None
        self.walk = d.get('walk', False)
        self.amount = FARM_FOOD
        self.farmer = None
        self.seen = owner == 0      # the human player has already seen the building (World sets it for allies)
        self.alive = True
        self.hit_t = -99
        self.garrison = []          # units inside (see game/defense.py)

    @property
    def complete(self):
        return self.progress >= 1.0

    def center(self):
        return (self.tx + self.w / 2) * TILE, (self.ty + self.h / 2) * TILE

    def armor(self):
        m, pc = self.d.get('arm', BUILDING_ARMOR) if self.complete else (0, 2)
        if self.p is not None and self.complete:
            m, pc = self.p.stat('arm_m', self.kind, m), self.p.stat('arm_p', self.kind, pc)
        return m, pc

    def atk(self):
        return self.p.stat('atk', self.kind, self.d.get('atk', 0))

    def rng_tiles(self):
        return self.p.stat('rng', self.kind, self.d.get('rng', 0))

    def los(self):
        return self.p.stat('los', self.kind, self.d.get('los', 4)) + self.w // 2

    def dist_px(self, x, y):
        # dist_point_rect(x, y, the building's rectangle), inlined: called millions of times
        rx = self.tx * TILE
        dx = rx - x
        if dx < 0:
            dx = x - rx - self.w * TILE
            if dx < 0:
                dx = 0
        ry = self.ty * TILE
        dy = ry - y
        if dy < 0:
            dy = y - ry - self.h * TILE
            if dy < 0:
                dy = 0
        if not dx:
            return float(dy)
        if not dy:
            return float(dx)
        return _hypot(dx, dy)

    def update(self, w, dt):
        if self.progress >= 1.0 and not self.queue and not self.garrison and not self.d.get('atk'):
            return          # completed, no queue, no garrison, not firing - nothing to do
        p = w.players[self.owner]
        if not self.complete:
            n = self.builders
            if n > 0:
                inc = dt * (3 * n / (n + 2)) / p.time_of('bld', self.kind)
                self.progress = min(1.0, self.progress + inc)
                self.hp = min(self.max_hp, self.hp + inc * self.max_hp)
                if self.progress >= 1.0:
                    w.on_complete(self)
            return
        if self.queue:
            kind, name = self.queue[0]
            if kind == 'unit' and p.pop >= p.cap:
                if not self.housed and self.owner == w.human:
                    w.msg(i18n.t('msg.need_houses'), (255, 150, 90))
                self.housed = True
            else:
                self.housed = False
                total = p.time_of(kind, name)
                self.qt += dt
                if self.qt >= total:
                    self.qt = 0.0
                    self.queue.pop(0)
                    cx, cy = self.center()
                    if kind == 'unit':
                        u = w.spawn(self, p.current(name))
                        p.pop += 1
                        w.emit('train_done', u.x, u.y, self.owner, u.kind)
                    else:
                        w.apply_tech(p, name)
                        w.emit('tech_done', cx, cy, self.owner, name)
        if self.garrison:
            defense.tick_garrison(w, self, dt)
        if self.d.get('atk'):
            self.cool = max(0.0, self.cool - dt)
            if self.cool <= 0:
                rng = self.rng_tiles() * TILE
                minr = p.stat('min_rng', self.kind, self.d.get('min_rng', 0)) * TILE
                t = self.target
                if t is None or not t.alive or not minr <= self.dist_px(t.x, t.y) - t.radius <= rng or \
                        not w.hmat[self.owner][t.owner]:
                    t = w.nearest_enemy_unit_for_building(self, rng, minr)
                self.target = t
                if t is not None:
                    self.cool = p.stat('reload', self.kind, self.d['reload'])
                    cx, cy = self.center()
                    for i in range(self.d.get('arrows', 1) + int(p.stat('arrows', self.kind, 0)) +
                                   defense.bonus_arrows(self)):
                        dmg = w.calc_damage(self, t, True)
                        w.fire(self, t, dmg, cx + random.uniform(-8, 8), cy - self.h * 10 + random.uniform(-6, 6),
                               delay=i * 0.12, sound=i == 0)


class Unit:
    inside = None           # the building in which the unit sits in a garrison (then alive == False)
    naval = False           # a ship (game/naval.py: Ship) - moves only on water
    # siege weapons with packing (a trebuchet): packed - can move, cannot fire; pack_t - (un)packing is in progress
    packed = True
    pack_t = 0.0
    faith_t = 0.0       # monk: the game time when the faith will be restored (can convert)
    relic = None        # monk: the carried relic (game/relics.py) - while carrying it he neither heals nor converts
    conv_t = 0.0        # monk: how many seconds the current conversion has been going
    _px = _py = 0.0     # the position at the previous step (for leading a shot)
    _sep_x = _sep_y = _sep_r = None     # World.separate: the position and radius at the start of the previous pushing-apart
    _sep_clear = False          # ... and then it did not intersect anyone
    # orders beyond cmd_* (game/orders.py): a stance, a queue of Shift orders, a long-running order, a formation
    stance = 'aggressive'
    orders = None
    mission = None
    mis_t = 0.0
    home = None
    auto = False
    form_speed = None
    gpt = None

    def __init__(self, kind, owner, x, y, world):
        d = UNITS[kind]
        self.d = d
        self.kind = kind
        self.owner = owner
        self.p = world.players[owner]
        self.x, self.y = x, y
        self.cls = d['cls']
        self.radius = d['radius']
        self.max_hp = self.p.stat('hp', kind, d['hp'])
        self.hp = float(self.max_hp)
        self.state = 'idle'
        self.target = None
        self.drop = None
        self.path = []
        self.dest = None
        self.pending = None
        self.path_target = None
        self.repath_t = 0.0
        self.cool = 0.0
        self.carry = 0.0
        self.carry_res = None
        self.gather_kind = None
        self.face = (1.0, 0.0)
        self.anim = 0.0
        self.swing = 0.0
        self.work = 0.0
        self.scan_t = random.random()
        self.alive = True
        self.hit_t = -99

    # ---- stats (the base from UNITS + the player's modifiers, see Player.stat)
    def atk(self):
        return self.p.stat('atk', self.kind, self.d['atk'])

    def armor(self):
        m, pc = self.d['arm']
        return self.p.stat('arm_m', self.kind, m), self.p.stat('arm_p', self.kind, pc)

    def rng_tiles(self):
        r = self.d['rng']
        return self.p.stat('rng', self.kind, r) if r > 0 else 0

    def rng_px(self):
        r = self.rng_tiles()
        return r * TILE if r > 0 else 4

    def reload(self):
        return self.p.stat('reload', self.kind, self.d['reload'])

    def speed(self):
        s = self.p.stat('speed', self.kind, self.d['speed']) * TILE
        fs = self.form_speed        # in a formation - at the speed of the slowest
        return fs if fs is not None and fs < s else s

    def capacity(self):
        return self.p.stat('carry', self.kind, CARRY, src=self.gather_kind)

    def los(self):
        return self.p.stat('los', self.kind, self.d['los'])

    def minr_px(self):
        """The minimum range (onager, trebuchet, bombard), pixels."""
        m = self.d.get('minr', 0)
        return m * TILE if m else 0

    def acc(self):
        return min(1.0, self.p.stat('acc', self.kind, self.d.get('acc', 1.0)))

    def look(self):
        """The kind for drawing: an unpacked trebuchet is drawn as a separate "pose" (d['look_up'])."""
        if self.d.get('pack') and (not self.packed) != (self.pack_t > 0):
            return self.d.get('look_up', self.kind)
        return self.kind

    def start_pack(self, w, goal):
        """goal=True - pack (to move), False - unpack (to fire)."""
        if self.pack_t > 0 or self.packed == goal:
            return
        self.pack_t = self.d['pack']
        w.emit('pack', self.x, self.y, self.owner, self.kind, goal)

    def set_kind(self, kind):
        """Turn a unit into another kind (a line upgrade), keeping the health share."""
        frac = self.hp / self.max_hp if self.max_hp else 1.0
        d = UNITS[kind]
        self.kind = kind
        self.d = d
        self.cls = d['cls']
        self.radius = d['radius']
        self.max_hp = self.p.stat('hp', kind, d['hp'])
        self.hp = max(1.0, self.max_hp * frac)

    def center(self):
        return self.x, self.y

    def tile(self):
        return int(self.x // TILE), int(self.y // TILE)

    def dist_to(self, e):
        if isinstance(e, Unit):
            return _hypot(e.x - self.x, e.y - self.y) - e.radius - self.radius
        # dist_point_rect to the rectangle of e (a building / resource), inlined
        x, y = self.x, self.y
        rx = e.tx * TILE
        dx = rx - x
        if dx < 0:
            dx = x - rx - e.w * TILE
            if dx < 0:
                dx = 0
        ry = e.ty * TILE
        dy = ry - y
        if dy < 0:
            dy = y - ry - e.h * TILE
            if dy < 0:
                dy = 0
        if not dx:
            return dy - self.radius
        if not dy:
            return dx - self.radius
        return _hypot(dx, dy) - self.radius

    # ---- orders
    def release(self):
        self.form_speed = None
        t = self.target
        if isinstance(t, Building) and t.kind == 'farm' and t.farmer is self:
            t.farmer = None

    def stop(self):
        self.release()
        self.state = 'idle'
        self.target = None
        self.path = []
        self.dest = None
        self.pending = None

    def cmd_move(self, x, y):
        self.release()
        self.state = 'move'
        self.target = None
        self.pending = (x, y)
        self.path = []
        self.dest = None

    def cmd_attack(self, t):
        if t is None:
            return
        if self.d.get('monk'):
            if self.relic is not None:
                return      # a monk carrying a relic does not convert (AoE2)
            if isinstance(t, Unit) and not isinstance(t, Animal):
                self.release()
                self.state = 'convert'
                self.target = t
                self.path_target = None
                self.conv_t = 0.0
            return      # a monk does not convert buildings
        if self.d.get('bld_only') and isinstance(t, Unit):
            self.cmd_move(t.x, t.y)
            return
        self.release()
        self.state = 'attack'
        self.target = t
        self.path_target = None

    def cmd_heal(self, t):
        """A monk heals an allied unit."""
        if not self.d.get('monk') or not isinstance(t, Unit) or self.relic is not None:
            return
        self.release()
        self.state = 'heal'
        self.target = t
        self.path_target = None

    def cmd_gather(self, t):
        if self.kind != 'villager':
            cx, cy = t.center()
            self.cmd_move(cx, cy)
            return
        self.release()
        self.state = 'gather'
        self.target = t
        if isinstance(t, Animal):
            self.gather_kind = 'hunt'
        else:
            self.gather_kind = 'farm' if isinstance(t, Building) else t.kind
        self.path_target = None

    def cmd_build(self, b):
        if self.kind != 'villager':
            return
        self.release()
        self.state = 'build'
        self.target = b
        self.path_target = None

    def cmd_return(self, b=None):
        if self.carry <= 0:
            return
        self.drop = b
        self.state = 'return'
        self.path_target = None

    # ---- movement
    def step_toward(self, w, px, py, dt):
        dx, dy = px - self.x, py - self.y
        d = math.hypot(dx, dy)
        if d < 0.5:
            return
        s = min(self.speed() * dt, d)
        nx, ny = self.x + dx / d * s, self.y + dy / d * s
        if w.passable_px(nx, ny, self.owner):
            self.x, self.y = nx, ny
        elif w.passable_px(nx, self.y, self.owner):
            self.x = nx
        elif w.passable_px(self.x, ny, self.owner):
            self.y = ny
        self.face = (dx / d, dy / d)
        self.anim += dt * 12

    def walk_path(self, w, dt):
        step = self.speed() * dt
        guard = 0
        while step > 0 and guard < 8:
            guard += 1
            if self.path:
                tx, ty = self.path[0]
                px, py = (tx + 0.5) * TILE, (ty + 0.5) * TILE
                if len(self.path) == 1 and self.dest is not None:
                    px, py = self.dest
            elif self.dest is not None:
                px, py = self.dest
            else:
                return True
            dx, dy = px - self.x, py - self.y
            d = math.hypot(dx, dy)
            if d <= step:
                self.x, self.y = px, py
                step -= d
                if self.path:
                    self.path.pop(0)
                    if not self.path:
                        self.dest = None
                        return True
                else:
                    self.dest = None
                    return True
            else:
                self.x += dx / d * step
                self.y += dy / d * step
                self.face = (dx / d, dy / d)
                self.anim += dt * 12
                step = 0
        return False

    def approach(self, w, ent, rng, dt):
        """Move to ent until within rng. True - already in the zone."""
        if self.dist_to(ent) <= rng:
            self.path = []
            return True
        if self.d.get('pack') and not self.packed:
            self.start_pack(w, True)
            return False
        if isinstance(ent, Unit) and math.hypot(ent.x - self.x, ent.y - self.y) < 2.5 * TILE:
            self.path = []
            self.step_toward(w, ent.x, ent.y, dt)
            return False
        need = self.path_target is not ent or (w.time >= self.repath_t and (not self.path or isinstance(ent, Unit)))
        if need and w.path_budget > 0:
            w.path_budget -= 1
            self.repath_t = w.time + (0.8 if isinstance(ent, Unit) else 2.5) + random.random() * 0.5
            self.path_target = ent
            self.path = w.path_to_entity(self, ent)
            self.dest = None
            if not w.path_reached and self.state == 'attack' and ent is self.target:
                # the path to the target is blocked by walls - break the nearest wall/gate segment
                wall = defense.breach_target(w, self, ent)
                if wall is not None:
                    self.target = wall
                    self.path_target = None
                    self.path = []
                    return False
        if self.path:
            self.dest = None
            self.walk_path(w, dt)
        else:
            cx, cy = ent.center()
            self.step_toward(w, cx, cy, dt)
        return False

    def face_to(self, e):
        cx, cy = e.center()
        dx, dy = cx - self.x, cy - self.y
        d = math.hypot(dx, dy)
        if d > 0.1:
            self.face = (dx / d, dy / d)

    # ---- update
    def update(self, w, dt):
        self._px, self._py = self.x, self.y
        c = self.cool - dt
        self.cool = c if c > 0.0 else 0.0
        c = self.swing - dt
        self.swing = c if c > 0.0 else 0.0
        if self.pack_t > 0:
            # packing/unpacking is in progress - we do nothing else
            self.pack_t -= dt
            if self.pack_t <= 0:
                self.pack_t = 0.0
                self.packed = not self.packed
            return
        if self.mission is not None:
            orders.tick(self, w, dt)
        st = self.state
        if st == 'idle' and (self.orders or self.mission is not None or self.home is not None):
            orders.on_idle(self, w)
            st = self.state
        if st == 'gather':
            self.do_gather(w, dt)
        elif st == 'idle':
            if self.cls != 'vil' and w.time >= self.scan_t:
                self.scan_t = w.time + 0.5
                self.idle_scan(w)
        elif st == 'move':
            self.do_move(w, dt)
        elif st == 'attack':
            self.do_attack(w, dt)
        elif st == 'return':
            self.do_return(w, dt)
        elif st == 'build':
            self.do_build(w, dt)
        elif st == 'garrison':
            defense.do_garrison(w, self, dt)
        elif st in self.d.get('states', ()):
            # states from content: UNITS[kind]['states'][name](unit, world, dt) (e.g. 'trade' for a cart)
            self.d['states'][st](self, w, dt)
        elif st == 'convert':
            self.do_convert(w, dt)
        elif st == 'heal':
            self.do_heal(w, dt)
        elif st == 'repair':
            orders.do_repair(self, w, dt)
        elif st == 'aground':
            orders.do_attack_ground(self, w, dt)

    def cmd_garrison(self, b):
        """Walk to a building and enter the garrison (see game/defense.py)."""
        self.release()
        self.state = 'garrison'
        self.target = b
        self.path_target = None

    def idle_scan(self, w):
        d = self.d
        if self.stance == 'no_attack':
            return
        if d.get('monk'):
            if self.relic is not None:
                return      # carrying a relic - neither healing nor converting
            # a monk heals wounded allies nearby on his own and converts enemies that came within range
            t = w.wounded_ally(self, self.los() * TILE)
            if t is not None:
                self.cmd_heal(t)
                return
            if w.time >= self.faith_t:
                e = w.nearest_enemy(self, self.rng_px(), buildings=False)
                if e is not None and w.convertible(self, e):
                    self.cmd_attack(e)
            return
        if d.get('pack') and self.packed:
            return      # a packed trebuchet stands and waits for an order
        radius = orders.scan_radius(self)
        e = w.nearest_enemy(self, radius, buildings=bool(d.get('bld_only') or d.get('pack')),
                            minr=self.minr_px(), units=not d.get('bld_only'))
        if e is None and not d.get('bld_only') and not self.naval and self.owner >= 0:
            e = w.nearest_beast(self, min(radius, self.los() * TILE))      # wolves in view
        if e is not None:
            orders.engage(self, e)

    def do_move(self, w, dt):
        if self.d.get('pack') and not self.packed:
            self.start_pack(w, True)
            return
        if self.pending is not None:
            if w.path_budget <= 0:
                return
            w.path_budget -= 1
            x, y = self.pending
            self.pending = None
            gx, gy = int(x // TILE), int(y // TILE)
            goal = (gx, gy) if w.passable(gx, gy) else w.nearest_free_tile(gx, gy)
            self.path = w.find_path(self.tile(), [goal], goal[0], goal[1], owner=self.owner)
            reached = (self.path and self.path[-1] == goal) or self.tile() == goal
            self.dest = (x, y) if reached and goal == (gx, gy) else None
        if self.walk_path(w, dt):
            self.state = 'idle'
            self.form_speed = None

    def do_attack(self, w, dt):
        t = self.target
        if t is not None and self.p is not None and not isinstance(t, Animal) and not w.hmat[self.owner][t.owner]:
            t = None        # the target was converted by a monk and became allied
        if t is None or not t.alive or getattr(t, 'dead', False):
            self.target = None
            e = None
            if self.orders:
                self.state = 'idle'     # the target fell - to the next point of the queue (Shift)
                return
            if self.cls != 'vil' and self.p is not None:
                d = self.d
                radius = orders.scan_radius(self)
                e = w.nearest_enemy(self, radius, buildings=True, minr=self.minr_px(), units=not d.get('bld_only'))
            if e is not None:
                self.cmd_attack(e)
            else:
                self.state = 'idle'
            return
        if self.auto and self.stance != 'aggressive' and not orders.may_chase(self, t):
            self.target = None      # stance: we do not pursue farther
            self.state = 'idle'
            return
        mr = self.minr_px()
        if mr and self.dist_to(t) < mr:
            # the target is closer than the minimum range: a trebuchet looks for another, the others back off
            if self.d.get('pack'):
                e = w.nearest_enemy(self, self.rng_px(), buildings=True, minr=mr)
                if e is not None and e is not t:
                    self.cmd_attack(e)
                else:
                    self.stop()
                return
            cx, cy = t.center()
            dx, dy = self.x - cx, self.y - cy
            dd = math.hypot(dx, dy) or 1
            self.step_toward(w, self.x + dx / dd * TILE, self.y + dy / dd * TILE, dt)
            return
        if self.approach(w, t, self.rng_px(), dt):
            self.face_to(t)
            if self.d.get('pack') and self.packed:
                self.start_pack(w, False)
                return
            if self.cool <= 0:
                self.cool = self.reload()
                self.swing = 0.3
                ranged = self.d['rng'] > 0
                dmg = w.calc_damage(self, t, ranged)
                if ranged:
                    w.fire(self, t, dmg)
                else:
                    w.damage(t, self, dmg)
                if 'on_attack' in self.d:
                    self.d['on_attack'](self, w, t, dmg)   # content: a volley, trampling (unique units)

    # ---- monk
    def do_convert(self, w, dt):
        t = self.target
        if t is None or not t.alive or not w.convertible(self, t):
            self.state = 'idle'
            self.target = None
            self.conv_t = 0.0
            return
        if w.time < self.faith_t:
            # faith has not been restored yet - stay close
            self.approach(w, t, self.rng_px(), dt)
            return
        if self.approach(w, t, self.rng_px(), dt):
            self.face_to(t)
            if self.conv_t == 0.0:
                w.emit('convert_start', self.x, self.y, self.owner, t.kind)
            prev = self.conv_t
            self.conv_t += dt * self.p.stat('conv_speed', self.kind, 1.0) / t.p.stat('conv_resist', t.kind, 1.0)
            self.swing = 0.3 if int(self.conv_t * 2) % 2 else 0.0
            # as in the original: not before 4 s, then every second a 28% chance, by 10 s - for certain
            if self.conv_t >= 10.0 or (self.conv_t >= 4.0 and int(self.conv_t) > int(prev)
                                       and random.random() < 0.28):
                w.convert(t, self)
                self.conv_t = 0.0
                self.faith_t = w.time + 62.0 / self.p.stat('faith', self.kind, 1.0)
                self.state = 'idle'
                self.target = None

    def do_heal(self, w, dt):
        t = self.target
        if t is None or not t.alive or t.hp >= t.max_hp or not w.allied(self.owner, t.owner):
            self.state = 'idle'
            self.target = None
            return
        if self.approach(w, t, 4 * TILE, dt):
            self.face_to(t)
            t.hp = min(t.max_hp, t.hp + self.p.stat('heal', self.kind, 1.0) * dt)
            self.swing = 0.3 if int(w.time * 2) % 2 else 0.0

    def gather_target_valid(self, t):
        if t is None or not t.alive:
            return False
        if isinstance(t, Building):
            return t.kind == 'farm' and t.complete and t.owner == self.owner and t.farmer in (None, self)
        if isinstance(t, Animal):
            if t.den is not None:
                return False            # a wolf is not game
            return t.dead or t.kind != 'sheep' or t.owner in (-1, self.owner)
        return True

    def do_gather(self, w, dt):
        t = self.target
        tt = type(t)
        # the frequent cases - a villager is already at a tree/mine/bush or on its own farm and gathers: a short path
        # doing exactly the same as the general path below for a target within reach
        if tt is Node:
            if t.alive and self.carry_res == t.res:
                x, y = self.x, self.y
                rx = t.tx * TILE
                dx = rx - x
                if dx < 0:
                    dx = x - rx - t.w * TILE
                    if dx < 0:
                        dx = 0
                ry = t.ty * TILE
                dy = ry - y
                if dy < 0:
                    dy = y - ry - t.h * TILE
                    if dy < 0:
                        dy = 0
                near = (dy if not dx else dx if not dy else _hypot(dx, dy)) - self.radius <= 10
            else:
                near = False
            if near:
                cap, rate = self._gather_stats(t, t.kind, t.res, NODE_DEFS[t.kind]['rate'])
                if self.carry >= cap:
                    self.cmd_return()
                    return
                self._gather_tick(w, t, dt, rate, t.res, t.kind)
                return
        elif tt is Building:
            if t.alive and t.kind == 'farm' and t.progress >= 1.0 and t.owner == self.owner and \
                    (t.farmer is None or t.farmer is self) and self.carry_res == 'food' and \
                    self.dist_to(t) <= 0.5 - self.radius:
                cap, rate = self._gather_stats(t, 'farm', 'food', FARM_RATE)
                if self.carry >= cap:
                    self.cmd_return()
                    return
                t.farmer = self
                self._gather_tick(w, t, dt, rate, 'food', 'farm')
                return
        if not self.gather_target_valid(t):
            self.release()
            nt = w.find_resource(self, self.gather_kind, self.x, self.y, 9)
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
        if isinstance(t, Animal) and not t.dead:
            rng = 3 * TILE if t.kind == 'deer' else 10
            if self.approach(w, t, rng, dt):
                self.face_to(t)
                if self.cool <= 0:
                    self.cool = 1.5
                    self.swing = 0.3
                    dmg = w.calc_damage(self, t, t.kind == 'deer')
                    if t.kind == 'deer':
                        w.projectiles.append(Projectile(self.x, self.y - 10, t, dmg, self))
                        w.emit('arrow', self.x, self.y, self.owner, self.kind)
                    else:
                        w.damage(t, self, dmg)
            return
        res = 'food' if isinstance(t, (Building, Animal)) else t.res
        if self.carry > 0 and self.carry_res != res:
            self.carry = 0
        if self.carry >= self.capacity():
            self.cmd_return()
            return
        if isinstance(t, Building):
            t.farmer = self
            if not self.approach(w, t, -self.radius + 0.5, dt):
                return
            rate, src = FARM_RATE, 'farm'
        elif isinstance(t, Animal):
            if not self.approach(w, t, 10, dt):
                return
            rate, src = ANIMALS[t.kind]['rate'], 'hunt'
        else:
            if not self.approach(w, t, 10, dt):
                return
            rate, src = NODE_DEFS[t.kind]['rate'], t.kind
        rate = self.p.stat('gather', self.kind, rate, res, src)
        self.face_to(t)
        self.work += dt
        if self.work > 1.0:
            self.work = 0.0
            self.swing = 0.3
            w.emit('work', self.x, self.y, self.owner, WORK_SOUND.get(src, 'forage'))
        amt = min(rate * dt, t.amount)
        t.amount -= amt
        self.carry += amt
        self.carry_res = res
        if t.amount <= 0:
            w.deplete(t)

    _gcache = None

    def _gather_stats(self, t, src, res, base_rate):
        """(capacity, gather rate) - the same capacity() and stat('gather', ...) as in the general path,
        but remembered until the target changes (and with it the gather kind), the unit kind, the player, its effects and the age."""
        p = self.p
        c = self._gcache
        if c is not None and c[0] is t and c[1] is p and c[2] == p.ver and c[3] == p.age and c[4] == self.kind:
            return c[5], c[6]
        cap = self.capacity()
        rate = p.stat('gather', self.kind, base_rate, res, src)
        self._gcache = (t, p, p.ver, p.age, self.kind, cap, rate)
        return cap, rate

    def _gather_tick(self, w, t, dt, rate, res, src):
        """Gathering at a target within reach (the end of the general do_gather path): the same as
        approach -> stat('gather') -> face_to -> ..., with face_to inlined (a hot path).
        rate - the final rate already (see _gather_stats)."""
        self.path = []
        cx, cy = t.center()
        dx, dy = cx - self.x, cy - self.y
        d = _hypot(dx, dy)
        if d > 0.1:
            self.face = (dx / d, dy / d)
        self.work += dt
        if self.work > 1.0:
            self.work = 0.0
            self.swing = 0.3
            w.emit('work', self.x, self.y, self.owner, WORK_SOUND.get(src, 'forage'))
        amt = rate * dt
        if amt > t.amount:
            amt = t.amount
        t.amount -= amt
        self.carry += amt
        self.carry_res = res
        if t.amount <= 0:
            w.deplete(t)

    def do_return(self, w, dt):
        if self.carry <= 0:
            self.resume_gather(w)
            return
        d = self.drop
        if d is None or not d.alive or not d.complete or self.carry_res not in d.d.get('drop', ()):
            d = w.nearest_dropoff(self, self.carry_res)
            self.drop = d
            self.path_target = None
        if d is None:
            self.state = 'idle'
            return
        if self.approach(w, d, 10, dt):
            amt = int(self.carry + 0.001)
            self.p.res[self.carry_res] += amt
            self.p.gathered[self.carry_res] += amt
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
            nt = w.find_resource(self, self.gather_kind, self.x, self.y, 10)
            if nt is not None:
                self.cmd_gather(nt)
                return
        self.state = 'idle'
        self.target = None

    def do_build(self, w, dt):
        b = self.target
        if b is None or not b.alive:
            self.state = 'idle'
            self.target = None
            return
        if b.complete:
            self.after_build(w, b)
            return
        if self.approach(w, b, 10, dt):
            self.face_to(b)
            b.builders += self.p.stat('build', self.kind, 1)
            self.work += dt
            if self.work > 0.8:
                self.work = 0.0
                self.swing = 0.3
                w.emit('work', self.x, self.y, self.owner, 'build')

    def after_build(self, w, b):
        self.target = None
        if self.orders:
            self.state = 'idle'         # Shift queue of constructions: the next one in the order of laying
            return
        if b.kind == 'farm' and b.farmer is None:
            self.cmd_gather(b)
            return
        pref = {'lumber_camp': ['tree'], 'mining_camp': ['gold', 'stone'], 'mill': ['berries']}.get(b.kind)
        if pref:
            cx, cy = b.center()
            for k in pref:
                nt = w.find_resource(self, k, cx, cy, 8)
                if nt is not None:
                    self.cmd_gather(nt)
                    return
        # the next construction is the nearest (walls are built segment by segment)
        best, bd = None, 10 * TILE
        for o in w.buildings:
            if o.owner == self.owner and not o.complete and o.alive:
                d = self.dist_to(o)
                if d < bd:
                    bd, best = d, o
        if best is not None:
            self.cmd_build(best)
            return
        self.state = 'idle'


class Animal(Unit):
    """Sheep, deer, boars, wolves. A killed animal stays as a carcass that villagers butcher
    (a wolf gives no food: the carcass disappears after WOLF_ROT s)."""
    dead_t = -99.0          # the game time of death (for the falling animation)
    den = None              # a predator: the point where it lives (it does not pursue farther than LEASH tiles)
    WOLF_ROT = 15.0
    LEASH = 12.0            # tiles from the den

    def __init__(self, kind, x, y, world, owner=-1):
        d = ANIMALS[kind]
        self.d = dict(d, reload=2.0, rng=0, cls='animal', cost={}, desc='')
        self.kind = kind
        self.owner = owner
        self.p = None
        self.x, self.y = x, y
        self.cls = 'animal'
        self.radius = d['radius']
        self.max_hp = d['hp']
        self.hp = float(d['hp'])
        self.state = 'idle'
        self.target = None
        self.drop = None
        self.path = []
        self.dest = None
        self.pending = None
        self.path_target = None
        self.repath_t = 0.0
        self.cool = 0.0
        self.carry = 0.0
        self.carry_res = None
        self.gather_kind = None
        self.face = (1.0, 0.0)
        self.anim = 0.0
        self.swing = 0.0
        self.work = 0.0
        self.scan_t = random.random()
        self.alive = True
        self.hit_t = -99
        self.dead = False
        self.amount = float(d['food'])
        self.res = 'food'
        self.flee_t = 0.0
        self.wander_t = random.uniform(5, 20)
        if d.get('predator'):
            self.den = (x, y)

    def atk(self):
        return self.d['atk']

    def armor(self):
        return self.d['arm']

    def rng_tiles(self):
        return 0

    def rng_px(self):
        return 4

    def reload(self):
        return self.d['reload']

    def speed(self):
        return self.d['speed'] * TILE

    def los(self):
        return self.d['los']

    def release(self):
        pass

    def on_hit(self, w, attacker):
        if self.kind in ('boar', 'wolf') and isinstance(attacker, Unit) and attacker.alive and self.state != 'attack':
            self.state = 'attack'
            self.target = attacker
            self.path_target = None
        elif self.kind == 'deer':
            self.flee(w, attacker.x, attacker.y, force=True)

    def on_death(self):
        self.dead = True
        self.hp = 0
        self.state = 'idle'
        self.path = []
        self.target = None
        self.owner = -1

    def flee(self, w, fx, fy, force=False):
        if w.time < self.flee_t and not force:
            return
        self.flee_t = w.time + 1.5
        dx, dy = self.x - fx, self.y - fy
        d = math.hypot(dx, dy) or 1
        tx, ty = self.x + dx / d * 4 * TILE, self.y + dy / d * 4 * TILE
        tx = max(TILE, min((w.W - 1) * TILE, tx))
        ty = max(TILE, min((w.H - 1) * TILE, ty))
        self.cmd_move(tx, ty)

    def prey(self, w, radius):
        """A predator: the nearest player unit on land within a radius (px), or None."""
        best, bd = None, radius
        for u in w.units_near(self.x, self.y, radius):
            if not u.alive or u.owner < 0 or u.naval:
                continue
            d = math.hypot(u.x - self.x, u.y - self.y)
            if d < bd:
                bd, best = d, u
        return best

    def update(self, w, dt):
        if self.dead:
            if self.den is not None and w.time - self.dead_t > self.WOLF_ROT:
                self.alive = False          # a wolf's carcass is not needed (no food) - remove it
            return
        c = self.cool - dt
        self.cool = c if c > 0.0 else 0.0
        c = self.swing - dt
        self.swing = c if c > 0.0 else 0.0
        if w.time >= self.scan_t:
            self.scan_t = w.time + 0.5
            near = [(math.hypot(u.x - self.x, u.y - self.y), u) for u in w.units_near(self.x, self.y, 4 * TILE)
                    if abs(u.x - self.x) < 4 * TILE and abs(u.y - self.y) < 4 * TILE]
            near = [(d, u) for d, u in near if d < 3.5 * TILE]
            if self.kind == 'sheep' and near:
                owners = {u.owner for _, u in near}
                if self.owner == -1 or self.owner not in owners:
                    self.owner = min(near, key=lambda t: t[0])[1].owner
            elif self.kind == 'deer' and near:
                d, u = min(near, key=lambda t: t[0])
                if d < 2.5 * TILE:
                    self.flee(w, u.x, u.y)
            if self.den is not None and self.state != 'attack':
                # a wolf: it rushes at any player unit in view if it has not gone far from the den
                hx, hy = self.den
                if math.hypot(self.x - hx, self.y - hy) < self.LEASH * TILE:
                    u = self.prey(w, self.los() * TILE)
                    if u is not None:
                        self.state = 'attack'
                        self.target = u
                        self.path_target = None
        if self.state == 'attack':
            t = self.target
            far = self.den is not None and math.hypot(self.x - self.den[0], self.y - self.den[1]) > self.LEASH * TILE
            if t is None or not t.alive or math.hypot(t.x - self.x, t.y - self.y) > 10 * TILE or far or \
                    getattr(t, 'naval', False):
                self.state = 'idle'
                self.target = None
                if far:
                    self.cmd_move(*self.den)        # it went away from the den - it returns
            else:
                Unit.do_attack(self, w, dt)
        elif self.state == 'move':
            self.do_move(w, dt)
        elif self.owner == -1 or self.kind != 'sheep':
            self.wander_t -= dt
            if self.wander_t <= 0:
                self.wander_t = random.uniform(8, 25)
                a = random.uniform(0, math.tau)
                if self.den is not None:        # a wolf roams near the den
                    r = random.uniform(0, 3) * TILE
                    self.cmd_move(self.den[0] + math.cos(a) * r, self.den[1] + math.sin(a) * r)
                    return
                self.cmd_move(self.x + math.cos(a) * TILE * 1.2, self.y + math.sin(a) * TILE * 1.2)


class Projectile:
    """A projectile. point=None - homing on the target (hunting); otherwise it flies to the point point - where it was aimed:
    if the target managed to move away, the projectile misses and may hit another enemy near the landing point.
    blast - the blast radius in pixels (mangonel, trebuchet, bombard): damage to everyone in the radius, own units too.
    pierce - a scorpion's bolt: it hits all enemies along the flight line."""

    def __init__(self, x, y, target, dmg, src, delay=0.0, point=None, blast=0.0, pierce=False, shape=None):
        self.x, self.y = x, y
        self.sx, self.sy = x, y
        self.target = target
        self.dmg = dmg
        self.src = src
        self.owner = src.owner
        self.delay = delay
        self.alive = True
        self.point = point
        self.blast = blast
        self.pierce = pierce
        self.hit = set()
        d = src.d if isinstance(src, Unit) else {}
        # the projectile kind for drawing: 'arrow' | 'javelin' | 'bolt' | 'stone' | 'ball'
        self.shape = shape or d.get('shot') or 'arrow'
        self.javelin = self.shape == 'javelin'
        self.speed = d.get('shot_speed', 260)

    def aim(self):
        if self.point is not None:
            return self.point[0], self.point[1] - 6
        t = self.target
        if isinstance(t, Unit):
            return t.x, t.y - 6
        return t.center()

    def update(self, w, dt):
        if self.delay > 0:
            self.delay -= dt
            return
        if self.point is None and not self.target.alive:
            self.alive = False
            return
        tx, ty = self.aim()
        dx, dy = tx - self.x, ty - self.y
        d = math.hypot(dx, dy)
        step = self.speed * dt
        if self.pierce:
            w.pierce_hits(self)
        if d <= step + 4:
            self.alive = False
            if self.point is None:
                w.damage(self.target, self.src, self.dmg)
            else:
                w.impact(self)
        else:
            self.x += dx / d * step
            self.y += dy / d * step


# ============================================================ world
class World:
    """The match's world. Player 0 is always the human (or the AI in his place in tools), -1 - nature (gaia).

    Events for sound/effects accumulate in self.events (tuples (type, x, y, owner, kind, ...));
    the consumer (the interface) takes and clears the list every frame. Types:
      'hit'          x, y, the target's owner, the attacker's kind, the target's kind
      'death'        x, y, owner, the unit's/animal's kind
      'destroy'      x, y, owner, the building's kind
      'arrow'        x, y, the shooter's owner, the shooter's kind (a shot)
      'work'         x, y, owner, the sound: 'chop' | 'mine' | 'farm' | 'forage' | 'butcher' | 'build'
      'build_done'   x, y, owner, the building's kind
      'place'        x, y, owner, the building's kind (a foundation was laid)
      'train_done'   x, y, owner, the unit's kind
      'tech_done'    x, y, owner, the tech
      'age_up'       x, y, owner, the age number
      'attack_alert' x, y, owner (who was attacked), the target's kind - no more than once per 10 s per player
      'defeat'       x, y, owner, None
      'game_over'    0, 0, the winning team (-1 - nobody), None
      'convert_start' x, y, the monk's owner, the target's kind (a monk started converting)
      'convert'      x, y, the new owner, the unit's kind, the old owner
      'pack'         x, y, owner, kind, True - packing / False - unpacking (a trebuchet)
      'blast'        x, y, the shooter's owner, its kind (a mangonel/trebuchet/bombard projectile explosion)
      the interface adds 'select' / 'command' (x, y, 0, kind / order).
    """

    def __init__(self, difficulty=1, nplayers=2, teams=None, ai_players=None, civs=None, size=None,
                 map_type='land', ai_levels=None, settings=None):
        """teams - the team number for each player (by default everyone on their own);
        ai_players - which players get the difficulty bonus (by default all except 0);
        map_type - 'land' (a continent with lakes) | 'coast' (a sea in the center) | 'islands' (see naval.MAP_TYPES);
        ai_levels - the AI level (0...5, as in DE: match.AI_LEVELS) per player; by default - from difficulty;
        settings - the match parameters from the lobby (game/match.py: resources, population, ages, treaty, victory...)."""
        self.difficulty = difficulty
        self.map_type = map_type
        self.settings = match.normalize(settings)
        self.settings['map'] = map_type
        n = max(2, min(len(PLAYER_COLORS), nplayers))
        if size is None and settings:
            size = match.map_side(self.settings, n, map_type)
        sizes = maps.LEGACY_SIZES if maps.is_legacy(map_type) else MAP_SIZES     # old types - the former sizes
        self.W = self.H = size or sizes.get(n, sizes[max(sizes)])
        self.pop_limit = 200
        self.max_age = 3
        self.treaty_end = 0.0
        self.reveal = 'normal'
        lv0 = match.LEVEL_OF_DIFF.get(difficulty, 2)
        self.ai_levels = [(ai_levels[i] if ai_levels and i < len(ai_levels) and ai_levels[i] is not None else lv0)
                          for i in range(n)]
        W, H = self.W, self.H
        self.time = 0.0
        self.terrain = [[0] * W for _ in range(H)]
        terrain.ensure(self)        # relief (game/terrain.py): heights, cliffs, shallows, ground types
        self.occ = [[None] * W for _ in range(H)]
        self.floor = [[None] * W for _ in range(H)]
        self.gate = [[None] * W for _ in range(H)]     # gates: passable for the owner and allies
        self.path_reached = True                        # whether the last find_path reached the target
        self.nodes = []
        self.units = []
        self.animals = []
        self.buildings = []
        self.projectiles = []
        self.decals = []
        self.events = []
        teams = list(teams) if teams else list(range(n))
        ai_players = set(range(1, n)) if ai_players is None else set(ai_players)
        self.players = []
        for pid in range(n):
            p = Player(pid, team=teams[pid], is_ai=pid in ai_players,
                       civ=(civs[pid] if civs and pid < len(civs) else 'default'))
            if p.is_ai:
                # difficulty - a gather bonus for computer players (the same mechanism as for techs)
                p.add_effects([{'stat': 'gather', 'mul': match.LEVEL_GATHER[self.ai_levels[pid]]}])
            self.players.append(p)
        self.human = 0
        self.update_teams()
        self.vis = bytearray(W * H)
        self.explored = bytearray(W * H)
        self.fog_version = 0
        self._fog_srcs = None       # the vision sources at the previous fog recomputation
        self.fog_t = 0.0
        self.messages = []
        self.pings = []
        self.alert_t = [-99.0] * n
        self.path_budget = 0
        self.dt = 0.0
        self.winner = None          # the number of the winning team (-1 - nobody); None - the game is on
        self.victory_t = 0.0
        self.nodes_dirty = False
        self._ug = {}               # the unit grid (see units_in_rect); built lazily once per step
        self._ug_src = None
        self._ug_n = 0
        self._ug_mask = {}
        self._hm_cache = {}
        self._sep_grid = None       # a flat grid for separate (reused between steps)
        self._sep_moved = None
        self._sep_pass = 0
        self.gen_map()
        for f in WORLD_HOOKS['init']:
            f(self)             # content: team bonuses, the civilizations' starting units...
        gstats.init(self)       # statistics for the achievements screen and the score
        match.apply_start(self)     # resources, age, population, map reveal, treaty (lobby)
        self.recount()
        self.update_fog()
        self.ais = []

    # ---- saving (game/savegame.py): caches are not written - they rebuild themselves
    _NOSAVE = ('_ug', '_ug_src', '_ug_mask', '_hm_cache', '_sep_grid', '_sep_moved', '_fog_srcs', '_bz')

    def __getstate__(self):
        d = dict(self.__dict__)
        for k in self._NOSAVE:
            d.pop(k, None)
        d['events'] = []
        return d

    def __setstate__(self, d):
        self.__dict__.update(d)
        self._ug = {}
        self._ug_src = None
        self._ug_mask = {}
        self._hm_cache = {}
        self._sep_grid = None
        self._sep_moved = None
        self._fog_srcs = None
        terrain.ensure(self)
        for k, v in (('settings', match.defaults()), ('pop_limit', 200), ('max_age', 3), ('treaty_end', 0.0),
                     ('reveal', 'normal')):
            if k not in self.__dict__:
                setattr(self, k, v)
        if 'stats' not in self.__dict__:
            gstats.init(self)

    # ---- teams and hostility
    def update_teams(self):
        """Recompute the hostility/alliance matrices. Call after changing teams.
        The matrices are (n+1) x (n+1): the last row/column is nature (-1), so
        self.hmat[a][b] works for owner == -1 too without checks."""
        n = len(self.players)
        tm = [p.team for p in self.players]
        # treaty (lobby): until it ends, other teams are not enemies - nobody attacks (neither the AI nor you)
        war = not (self.time < getattr(self, 'treaty_end', 0.0))
        self.hmat = [[war and a < n and b < n and tm[a] != tm[b] for b in range(n + 1)] for a in range(n + 1)]
        self._hm_cache = {}
        self.amat = [[a < n and b < n and tm[a] == tm[b] for b in range(n + 1)] for a in range(n + 1)]
        # whom an animal (a boar) attacks: any player
        self.beast_row = [True] * n + [False]

    def hostile(self, a, b):
        """Whether owners a and b are enemies (both real players from different teams). Nature (-1) is not an enemy."""
        return self.hmat[a][b]

    def allied(self, a, b):
        """One team (including oneself); nature (-1) is not an ally."""
        return self.amat[a][b]

    def ally_of_human(self, owner):
        return self.amat[self.human][owner]

    def team_players(self, team):
        return [p for p in self.players if p.team == team]

    # ---- messages and events
    def msg(self, text, color=(240, 235, 220)):
        self.messages.append((text, self.time, color))
        self.messages = self.messages[-6:]

    def emit(self, *ev):
        self.events.append(ev)

    # ---- map
    def gen_map(self):
        if not maps.is_legacy(self.map_type):
            mapgen.generate(self)           # maps by DE rules (game/mapgen.py)
            return
        W, H = self.W, self.H
        n = len(self.players)
        mx, my = (W - 1) / 2, (H - 1) / 2
        # starts on a circle; the rotation is chosen so that everyone stands as far from the center as possible
        margin = 14
        best = None
        for _ in range(32):
            base = random.uniform(0, math.tau)
            angs = [base + i * math.tau / n for i in range(n)]
            R = min(min((W / 2 - margin) / max(abs(math.cos(a)), 1e-6),
                        (H / 2 - margin) / max(abs(math.sin(a)), 1e-6)) for a in angs)
            if best is None or R > best[0] + 0.01:
                best = (R, angs)
        R, angs = best
        # allies - in neighboring places of the circle
        together = self.settings.get('team_together', True)     # lobby: "Team Together"
        order = sorted(range(n), key=lambda pid: (self.players[pid].team if together else 0, random.random()))
        slot_ang = [0.0] * n
        starts = [None] * n
        for slot, pid in enumerate(order):
            a = angs[slot]
            slot_ang[pid] = a
            starts[pid] = (int(round(mx + math.cos(a) * R)), int(round(my + math.sin(a) * R)))
        self.starts = starts
        # "forward" for each player - toward the center of the map; the starting set is built in this coordinate system
        fwd = [a + math.pi for a in slot_ang]

        def far(x, y, d):
            return all(math.hypot(x - sx, y - sy) >= d for sx, sy in starts)

        def inb(x, y):
            return 0 <= x < W and 0 <= y < H

        def put(kind, x, y):
            if inb(x, y) and self.terrain[y][x] == 0 and self.occ[y][x] is None and far(x, y, 5.5):
                nd = Node(kind, x, y)
                self.nodes.append(nd)
                self.occ[y][x] = nd

        def blob_shape(r, prob):
            cells = []
            for y in range(int(-r - 1), int(r + 2)):
                for x in range(int(-r - 1), int(r + 2)):
                    if math.hypot(x, y) <= r + random.uniform(-0.7, 0.5) and random.random() < prob:
                        cells.append((x, y))
            return cells

        def cluster_shape(k):
            cells = [(0, 0)]
            placed = {(0, 0)}
            tries = 0
            while len(placed) < k and tries < 200:
                tries += 1
                x, y = random.choice(cells)
                dx, dy = random.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
                c = (x + dx, y + dy)
                if c not in placed:
                    placed.add(c)
                    cells.append(c)
            return cells

        def stamp(kind, cx, cy, shape):
            for dx, dy in shape:
                put(kind, cx + dx, cy + dy)

        def fits(cx, cy, shape):
            return all(inb(cx + dx, cy + dy) and self.terrain[cy + dy][cx + dx] == 0 and
                       self.occ[cy + dy][cx + dx] is None and far(cx + dx, cy + dy, 5.5) for dx, dy in shape)

        def stamp_fit(kind, cx, cy, shape):
            """Place a figure as a whole (identically for all players, for fairness), shifting it by 1-3 tiles
            if something is in the way."""
            for r in range(4):
                for dy in range(-r, r + 1):
                    for dx in range(-r, r + 1):
                        if max(abs(dx), abs(dy)) == r and fits(cx + dx, cy + dy, shape):
                            stamp(kind, cx + dx, cy + dy, shape)
                            return
            stamp(kind, cx, cy, shape)

        def at(pid, rel, d):
            """A tile at distance d from the player's start in the direction fwd + rel."""
            sx, sy = starts[pid]
            a = fwd[pid] + rel
            x = int(round(sx + math.cos(a) * d))
            y = int(round(sy + math.sin(a) * d))
            return max(2, min(W - 3, x)), max(2, min(H - 3, y))

        water_map = self.map_type != 'land'
        if water_map:
            # sea / islands (game/naval.py); after that resources are placed only on land
            naval.gen_water(self, starts, slot_ang, R)
        # lakes - away from all starts
        for _ in range(0 if water_map else 3 + n):
            cx, cy = random.randrange(10, W - 10), random.randrange(10, H - 10)
            if not far(cx, cy, 20):
                continue
            r = random.uniform(2.5, 4.5)
            for y in range(int(cy - r - 2), int(cy + r + 3)):
                for x in range(int(cx - r - 2), int(cx + r + 3)):
                    if inb(x, y) and math.hypot(x - cx, y - cy) <= r + random.uniform(-0.8, 0.8) and far(x, y, 16):
                        self.terrain[y][x] = 1
        terrain.gen_shallows(self, starts)      # shallows along the rim of lakes and shores
        terrain.gen_heights(self, starts)       # hills (the starts are on flat sites)
        # the starting set: an identical layout rotated toward the center of the map for each player
        base = random.uniform(0, math.tau)
        rel = [base + i * math.tau / 5 for i in range(5)]
        random.shuffle(rel)
        package = [('tree', rel[0], 10, blob_shape(3.5, 0.9)),
                   ('tree', rel[0] + 0.5, 13, blob_shape(3.0, 0.9)),
                   ('gold', rel[1], 9, cluster_shape(7)),
                   ('stone', rel[2], 10, cluster_shape(5)),
                   ('berries', rel[3], 7, cluster_shape(6)),
                   ('gold', rel[4], 16, cluster_shape(6))]
        for kind, ra, d, shape in package:
            for pid in range(n):
                stamp_fit(kind, *at(pid, ra, d), shape)
        # resources "ahead" of each player (toward the center of the map) - also identical for all
        # (on water maps ahead there is sea - place them closer and to the sides)
        d0, d1, fr, spread = (11, 17, 10, 2.6) if water_map else (19, 27, 16, 1.1)
        for kind, k in (('gold', 6), ('gold', 5), ('stone', 5), ('berries', 5)):
            shape = cluster_shape(k)
            for _ in range(30):
                ra, d = random.uniform(-spread, spread), random.uniform(d0, d1)
                pts = [at(pid, ra, d) for pid in range(n)]
                if all(far(x, y, fr) and self.terrain[y][x] == 0 and self.occ[y][x] is None for x, y in pts):
                    for x, y in pts:
                        stamp_fit(kind, x, y, shape)
                    break
        # forest across the map (density - as on a 96x96 map)
        land = sum(row.count(0) for row in self.terrain) if water_map else W * H
        isl = self.map_type == 'islands'        # on islands the forest is denser - otherwise there will not be enough wood for the navy
        for _ in range(int(26 * land / (96 * 96) * (3.0 if isl else 1))):
            cx, cy = random.randrange(W), random.randrange(H)
            for _ in range(12 if water_map else 0):
                if self.terrain[cy][cx] == 0:
                    break
                cx, cy = random.randrange(W), random.randrange(H)
            if far(cx, cy, 8.5 if isl else 11):
                stamp('tree', cx, cy, blob_shape(random.uniform(1.5, 4.5), 0.85))
        # forest along the edges
        for y in range(H):
            for x in range(W):
                e = min(x, y, W - 1 - x, H - 1 - y)
                if e < 2 and random.random() < 0.55 and far(x, y, 9):
                    put('tree', x, y)
        terrain.gen_cliffs(self, starts)        # cliffs (do not split the map)
        # starting buildings and units
        for pid, (cx, cy) in enumerate(starts):
            tc = self.place_building('town_center', pid, cx - 2, cy - 2, complete=True)
            ox = 1 if math.cos(fwd[pid]) >= 0 else -1
            oy = 1 if math.sin(fwd[pid]) >= 0 else -1
            spots = [(cx + 3 * ox, cy), (cx, cy + 3 * oy), (cx + 3 * ox, cy + 3 * oy)]
            for (tx, ty) in spots:
                tx, ty = self.nearest_free_tile(tx, ty)
                self.units.append(Unit('villager', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, self))
            tx, ty = self.nearest_free_tile(cx - 3 * ox, cy + 3 * oy)
            self.units.append(Unit('scout', pid, (tx + 0.5) * TILE, (ty + 0.5) * TILE, self))
            tc.rally = None

        # animals: 4 own sheep by the center, pairs of sheep, deer, boars - identical for all
        def free_near(x, y):
            x, y = int(round(max(2, min(W - 3, x)))), int(round(max(2, min(H - 3, y))))
            return self.nearest_free_tile(x, y)

        herd = []   # (kind, own?, angle, distance, x offset, y offset)
        sheep_a = random.uniform(-2.2, 2.2)
        for i in range(4):
            herd.append(('sheep', True, sheep_a, 4.5, i % 2, i // 2))
        for ra, dist, kind, k in ((0.4, 13, 'sheep', 2), (1.3, 15, 'sheep', 2), (2.6, 12, 'sheep', 2),
                                  (random.uniform(0, 6.28), 16, 'deer', 3), (random.uniform(0, 6.28), 14, 'boar', 1),
                                  (random.uniform(0, 6.28), 17, 'boar', 1)):
            for i in range(k):
                herd.append((kind, False, ra, dist, i % 2, i // 2))
        for kind, own, ra, dist, ddx, ddy in herd:
            for pid in range(n):
                sx, sy = starts[pid]
                a = fwd[pid] + ra
                tx, ty = free_near(sx + math.cos(a) * dist + ddx, sy + math.sin(a) * dist + ddy)
                if water_map and not naval.same_land(self, (tx, ty), starts[pid]):
                    tx, ty = free_near(sx + math.cos(a) * dist * 0.5 + ddx, sy + math.sin(a) * dist * 0.5 + ddy)
                self.animals.append(Animal(kind, (tx + 0.5) * TILE, (ty + 0.5) * TILE, self, pid if own else -1))
        if water_map:
            naval.place_fish(self, starts, fwd)
        terrain.gen_ground(self, starts)        # ground types for textures and blending

    # ---- relief (game/terrain.py)
    def z_at(self, x, y):
        """The ground height under a world point (logical px) in screen pixels."""
        return terrain.z_at(self, x, y) if self.relief else 0.0

    def elev(self, tx, ty):
        """The integer height level of a cell (0..7)."""
        return terrain.elev(self, tx, ty)

    # ---- passability
    def passable(self, x, y):
        # land and shallows (codes 0, 2) are passable, water and cliff (1, 3) are not
        return 0 <= x < self.W and 0 <= y < self.H and not self.terrain[y][x] & 1 and self.occ[y][x] is None

    def passable_px(self, x, y, owner=None):
        if owner is None:
            return self.passable(int(x // TILE), int(y // TILE))
        return self.passable_for(int(x // TILE), int(y // TILE), owner)

    def passable_for(self, x, y, owner):
        """Passability for a unit of owner owner: own and allied completed gates are open."""
        if self.passable(x, y):
            return True
        if 0 <= x < self.W and 0 <= y < self.H:
            g = self.gate[y][x]
            return g is not None and g is self.occ[y][x] and g.progress >= 1.0 and self.amat[owner][g.owner]
        return False

    def nearest_free_tile(self, tx, ty, maxr=12):
        if self.passable(tx, ty):
            return tx, ty
        for r in range(1, maxr):
            best = None
            bd = 1e9
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    if self.passable(tx + dx, ty + dy):
                        d = dx * dx + dy * dy
                        if d < bd:
                            bd, best = d, (tx + dx, ty + dy)
            if best:
                return best
        return tx, ty

    def find_path(self, start, goals, hx, hy, limit=1800, owner=None):
        """A*; owner - whose unit is walking (own/allied gates are passable). self.path_reached - whether it reached the target.
        The passability of the four straight neighbors is computed once per expansion, a diagonal - only if
        both adjacent straight cells are open (the result is the same as when checking by DIRS)."""
        W, H = self.W, self.H
        sx, sy = start
        s = sy * W + sx
        gset = {y * W + x for x, y in goals}
        self.path_reached = True
        if s in gset:
            return []
        terr = self.terrain
        occ = self.occ
        gate = self.gate
        arow = self.amat[owner] if owner is not None else None

        def gate_ok(x, y, o):
            g = gate[y][x]
            return g is o and g.progress >= 1.0 and arow[g.owner]

        heappush, heappop = heapq.heappush, heapq.heappop
        openh = [(0.0, 0.0, s)]
        g = {s: 0.0}
        gget = g.get
        came = {s: -1}
        best = s
        besth = 1e9
        n = 0
        D = 1.414
        while openh and n < limit:
            f, gc, c = heappop(openh)
            if gc > g[c]:
                continue
            n += 1
            if c in gset:
                best = c
                break
            y, x = divmod(c, W)
            ex = x - hx
            if ex < 0:
                ex = -ex
            ey = y - hy
            if ey < 0:
                ey = -ey
            h = ex + 0.414 * ey if ex >= ey else ey + 0.414 * ex
            if h < besth:
                besth, best = h, c
            # straight neighbors: E, W, S, N
            trow, orow = terr[y], occ[y]
            e = x + 1 < W and not trow[x + 1] & 1 and (orow[x + 1] is None or
                                                     (arow is not None and gate_ok(x + 1, y, orow[x + 1])))
            wv = x > 0 and not trow[x - 1] & 1 and (orow[x - 1] is None or
                                                 (arow is not None and gate_ok(x - 1, y, orow[x - 1])))
            if y + 1 < H:
                rs, os_ = terr[y + 1], occ[y + 1]
                so = not rs[x] & 1 and (os_[x] is None or (arow is not None and gate_ok(x, y + 1, os_[x])))
            else:
                so = False
            if y > 0:
                rn, on = terr[y - 1], occ[y - 1]
                no = not rn[x] & 1 and (on[x] is None or (arow is not None and gate_ok(x, y - 1, on[x])))
            else:
                no = False
            cand = []
            if e:
                cand.append((x + 1, y, 1.0))
            if wv:
                cand.append((x - 1, y, 1.0))
            if so:
                cand.append((x, y + 1, 1.0))
            if no:
                cand.append((x, y - 1, 1.0))
            # a diagonal: both adjacent straights are open (so the indices are within the map too)
            if e and so and not rs[x + 1] & 1 and (os_[x + 1] is None or
                                                (arow is not None and gate_ok(x + 1, y + 1, os_[x + 1]))):
                cand.append((x + 1, y + 1, D))
            if e and no and not rn[x + 1] & 1 and (on[x + 1] is None or
                                                (arow is not None and gate_ok(x + 1, y - 1, on[x + 1]))):
                cand.append((x + 1, y - 1, D))
            if wv and so and not rs[x - 1] & 1 and (os_[x - 1] is None or
                                                 (arow is not None and gate_ok(x - 1, y + 1, os_[x - 1]))):
                cand.append((x - 1, y + 1, D))
            if wv and no and not rn[x - 1] & 1 and (on[x - 1] is None or
                                                 (arow is not None and gate_ok(x - 1, y - 1, on[x - 1]))):
                cand.append((x - 1, y - 1, D))
            for nx, ny, cost in cand:
                nc = ny * W + nx
                ng = gc + cost
                if ng < gget(nc, 1e18):
                    g[nc] = ng
                    came[nc] = c
                    ex = nx - hx
                    if ex < 0:
                        ex = -ex
                    ey = ny - hy
                    if ey < 0:
                        ey = -ey
                    # (ng + max) + 0.414*min - the same order of addition as before (the same floats)
                    heappush(openh, (ng + ex + 0.414 * ey if ex >= ey else ng + ey + 0.414 * ex, ng, nc))
        self.path_reached = best in gset
        path = []
        c = best
        while c != s and c != -1:
            path.append((c % W, c // W))
            c = came[c]
        path.reverse()
        return path

    def path_to_entity(self, u, e):
        if isinstance(e, Unit):
            g = e.tile()
            return self.find_path(u.tile(), [g], g[0], g[1], owner=u.owner)
        hx, hy = e.tx + e.w // 2, e.ty + e.h // 2
        if getattr(e, 'walk', False):
            goals = [(x, y) for x in range(e.tx, e.tx + e.w) for y in range(e.ty, e.ty + e.h)]
        else:
            goals = []
            for y in range(e.ty - 1, e.ty + e.h + 1):
                for x in range(e.tx - 1, e.tx + e.w + 1):
                    inside = e.tx <= x < e.tx + e.w and e.ty <= y < e.ty + e.h
                    if not inside and self.passable(x, y):
                        goals.append((x, y))
        return self.find_path(u.tile(), goals, hx, hy, owner=u.owner)

    # ---- buildings
    def can_place(self, kind, tx, ty, pid, check_explored=True):
        if BUILDINGS[kind].get('water'):
            return naval.can_place_water(self, kind, tx, ty, pid, check_explored)
        s = BUILDINGS[kind]['size']
        for y in range(ty, ty + s):
            for x in range(tx, tx + s):
                if not (0 <= x < self.W and 0 <= y < self.H):
                    return False
                if self.terrain[y][x] != 0 or self.occ[y][x] is not None or self.floor[y][x] is not None:
                    return False
                if pid == self.human and check_explored and not self.explored[y * self.W + x]:
                    return False
        if self.relief and not terrain.slope_ok(self, tx, ty, s):
            return False                # a slope steeper than a level per base (AoE2: gentle slopes are allowed)
        if kind != 'farm':
            for u in self.units:
                if u.owner != pid and tx * TILE - 4 <= u.x <= (tx + s) * TILE + 4 and \
                        ty * TILE - 4 <= u.y <= (ty + s) * TILE + 4:
                    return False
        return True

    def place_building(self, kind, pid, tx, ty, complete=False, size=None):
        """size - (width, height) for non-square buildings (gates 4x1 / 1x4).
        The kind is taken with the player's upgrades in mind (watch tower -> guard tower -> keep)."""
        kind = self.players[pid].current(kind)
        b = Building(kind, pid, tx, ty, complete, self.players[pid])
        if size:
            b.w, b.h = size
        b.seen = self.ally_of_human(pid)
        is_gate = b.d.get('gate', False)
        for y in range(ty, ty + b.h):
            for x in range(tx, tx + b.w):
                if b.walk:
                    self.floor[y][x] = b
                else:
                    self.occ[y][x] = b
                    if is_gate:
                        self.gate[y][x] = b
        self.buildings.append(b)
        if not b.walk:
            for u in self.units + self.animals:
                ux, uy = u.tile()
                if tx <= ux < tx + b.w and ty <= uy < ty + b.h:
                    fx, fy = naval.nearest_water_tile(self, ux, uy) if u.naval else self.nearest_free_tile(ux, uy)
                    u.x, u.y = (fx + 0.5) * TILE, (fy + 0.5) * TILE
                    self._ug_src = None     # a unit jumped - rebuild the unit grid
                    u.path = []
                    u.path_target = None
        if not complete:
            cx, cy = b.center()
            self.emit('place', cx, cy, pid, kind)
        return b

    def remove_building(self, b, rubble=True):
        if not b.alive:
            return
        b.alive = False
        for y in range(b.ty, b.ty + b.h):
            for x in range(b.tx, b.tx + b.w):
                if self.occ[y][x] is b:
                    self.occ[y][x] = None
                if self.floor[y][x] is b:
                    self.floor[y][x] = None
        if rubble:
            self.decals.append(['rubble', b.tx, b.ty, b.w, self.time, b.kind])
        if 'on_remove' in b.d:
            b.d['on_remove'](self, b)       # content (e.g. "Nomads": a house does not take population away)
        p = self.players[b.owner]
        for kind, name in b.queue:
            if kind == 'tech':
                p.researching.discard(name)
            p.refund(p.cost_of(kind, name))
        b.queue = []
        if b.garrison:
            defense.eject(self, b)

    def on_complete(self, b):
        p = self.players[b.owner]
        if b.kind == 'farm':
            b.amount = p.stat('farm_food', 'farm', FARM_FOOD)
        cx, cy = b.center()
        gstats.on_complete(self, b)
        self.emit('build_done', cx, cy, b.owner, b.kind)
        if b.owner == self.human:
            self.msg(i18n.t('msg.built', name=b.d['name']), (170, 230, 150))

    def spawn(self, b, kind):
        if UNITS[kind].get('naval'):
            return naval.spawn_ship(self, b, kind)
        # a free cell around the building (from below first)
        cand = []
        for y in range(b.ty - 1, b.ty + b.h + 1):
            for x in range(b.tx - 1, b.tx + b.w + 1):
                if not (b.tx <= x < b.tx + b.w and b.ty <= y < b.ty + b.h) and self.passable(x, y):
                    cand.append((-(y - b.ty) * 2 - (x - b.tx), x, y))
        if cand:
            cand.sort()
            _, tx, ty = cand[0]
        else:
            tx, ty = self.nearest_free_tile(b.tx + b.w // 2, b.ty + b.h)
        u = Unit(kind, b.owner, (tx + 0.5) * TILE + random.uniform(-4, 4),
                 (ty + 0.5) * TILE + random.uniform(-4, 4), self)
        self.units.append(u)
        orders.apply_rally(self, b, u)
        return u

    def apply_tech(self, p, name):
        t = TECHS[name]
        p.techs.add(name)
        p.researching.discard(name)
        gstats.on_tech(self, p, name)
        if name in AGE_TECHS:
            p.age += 1
            tc = next((b for b in self.buildings if b.owner == p.id and b.kind == 'town_center'), None)
            cx, cy = tc.center() if tc else (0, 0)
            self.emit('age_up', cx, cy, p.id, p.age)
            if p.id == self.human:
                self.msg(i18n.t('msg.you_reached', age=AGE_NAMES[p.age]), (255, 220, 120))
            else:
                col = (150, 230, 160) if self.allied(self.human, p.id) else (255, 150, 130)
                self.msg(i18n.t('msg.reached', name=p.name, age=AGE_NAMES[p.age]), col)
        elif p.id == self.human:
            self.msg(i18n.t('msg.researched', name=t['name']), (170, 230, 150))
        if t.get('upgrade'):
            self.upgrade_line(p, *t['upgrade'])
        if t.get('effects'):
            p.add_effects(t['effects'])
            if any(e['stat'] == 'hp' for e in t['effects']):
                self.refresh_hp(p)
        if t.get('on_apply'):
            t['on_apply'](self, p)      # an arbitrary content action (e.g. turning towers into others)

    def upgrade_line(self, p, old, new):
        """A line upgrade: all units old -> new, buildings train new (and everything that used to lead to old).
        Units converted by a monk for other players stay of their own kind (as in the original)."""
        for k, v in list(p.alias.items()):
            if v == old:
                p.alias[k] = new
        p.alias[old] = new
        for u in self.units:
            if u.owner == p.id and u.kind == old:
                u.set_kind(new)

    def refresh_hp(self, p):
        """After effects on 'hp': raise the maximum health (and the current one by the same amount)."""
        for e in self.units:
            if e.owner == p.id:
                m = p.stat('hp', e.kind, e.d['hp'])
                if m != e.max_hp:
                    e.hp = max(1.0, e.hp + m - e.max_hp)
                    e.max_hp = m
        for b in self.buildings:
            if b.owner == p.id:
                m = p.stat('hp', b.kind, b.d['hp'])
                if m != b.max_hp:
                    if b.complete:
                        b.hp = max(1.0, b.hp + m - b.max_hp)
                    b.max_hp = m

    def tech_state(self, p, name, b=None):
        """(is_allowed, reason)"""
        t = TECHS[name]
        T = i18n.t
        if name in p.techs:
            return False, T('msg.already_researched')
        if not p.allows(name):
            return False, T('msg.civ_unavailable')
        if name in p.researching:
            return False, T('msg.researching')
        if name in AGE_TECHS:
            if p.age >= getattr(self, 'max_age', 3):
                return False, T('msg.final_age')
            if p.age != t['age']:
                return False, T('msg.need_previous_age')
            if any(a in p.researching for a in AGE_TECHS):
                return False, T('msg.age_in_progress')
            need, cnt = AGE_REQ[name]
            have = {x.kind for x in self.buildings if x.owner == p.id and x.complete and x.kind in need}
            if len(have) < cnt:
                names = ', '.join(BUILDINGS[k]['name'] for k in sorted(need))
                return False, T('msg.need_n_of', n=cnt, names=names)
        elif p.age < t['age']:
            return False, T('msg.need_age', age=AGE_NAMES[t['age']])
        for r in as_tuple(t.get('req', ())):
            if r not in p.techs:
                return False, T('msg.requires', name=TECHS[r]['name'])
        return True, ''

    # ---- resources
    def deplete(self, t):
        t.alive = False
        if isinstance(t, Node):
            self.nodes_dirty = True
            if self.occ[t.ty][t.tx] is t:
                self.occ[t.ty][t.tx] = None
            if t.kind == 'tree':
                self.decals.append(['stump', t.tx, t.ty, 1, self.time])
        elif isinstance(t, Building):
            farmer, t.farmer = t.farmer, None
            t.alive = True                  # remove_building skips already removed ones - free the farm's cells
            self.remove_building(t, rubble=False)
            if t.kind == 'farm':
                from .market import farm_expired     # the farm reseed queue
                farm_expired(self, t, farmer)

    def exposed(self, n):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if self.passable(n.tx + dx, n.ty + dy):
                return True
        return False

    def find_resource(self, u, kind, x, y, radius):
        if kind is None:
            return None
        best = None
        bd = radius * TILE
        if kind == 'hunt':
            for pri in (0, 1):
                for a in self.animals:
                    if not a.alive or a.kind == 'boar' and not a.dead or a.den is not None:
                        continue
                    if pri == 0 and not a.dead:
                        continue
                    if not a.dead and a.kind == 'sheep' and a.owner not in (-1, u.owner):
                        continue
                    d = math.hypot(a.x - x, a.y - y)
                    if d < bd:
                        bd, best = d, a
                if best is not None:
                    return best
            return None
        if kind == 'farm':
            for b in self.buildings:
                if b.alive and b.kind == 'farm' and b.owner == u.owner and b.complete and b.farmer in (None, u):
                    cx, cy = b.center()
                    d = math.hypot(cx - x, cy - y)
                    if d < bd:
                        bd, best = d, b
            return best
        for n in self.nodes:
            if n.kind != kind or not n.alive:
                continue
            cx, cy = (n.tx + 0.5) * TILE, (n.ty + 0.5) * TILE
            d = abs(cx - x) + abs(cy - y)
            if d < bd * 1.3 and math.hypot(cx - x, cy - y) < bd and self.exposed(n):
                bd, best = math.hypot(cx - x, cy - y), n
        return best

    def nearest_dropoff(self, u, res):
        best = None
        bd = 1e18
        for b in self.buildings:
            if b.owner == u.owner and b.alive and b.complete and res in b.d.get('drop', ()):
                d = u.dist_to(b)
                if d < bd:
                    bd, best = d, b
        return best

    # ---- combat
    def calc_damage(self, att, target, ranged=None):
        """Damage by the rules of the original: max(1, sum over attack classes of max(0, attack - armor of the same class)).
        The main attack is melee or ranged (d['dtype'] 'melee' | 'pierce'; by default ranged if
        it is a shot). Bonuses d['bonus'] = {the target's armor class: +damage} work if the target has that class
        (unit_tags: cls + 'ac'); the target's armor against a class - its d['carm'] = {class: armor}.
        'bonus:<class>' modifiers (techs) change the bonuses, including adding new ones."""
        d = att.d
        atk = att.atk()
        ma, pa = target.armor()
        dt = d.get('dtype') or ('pierce' if ranged else 'melee')
        total = max(0, atk - (pa if dt == 'pierce' else ma))
        p = att.p
        if isinstance(target, Animal):
            return max(1, total)
        bmap = d.get('bonus') or {}
        carm = target.d.get('carm') or {}
        for c in unit_tags(target.kind):
            v = bmap.get(c, 0)
            if p is not None:
                v = p.stat(_BONUS_KEY.get(c) or _bonus_key(c), att.kind, v)
            if v > 0:
                total += max(0, v - carm.get(c, 0))
        if self.relief:
            m = terrain.height_mult(self, att, target)          # +-25 % for height (DE)
            if m != 1.0:
                return max(1, total) * m
        return max(1, total)

    # ---- shots, misses, explosions
    def fire(self, src, t, dmg, x=None, y=None, delay=0.0, sound=True):
        """Fire a projectile src at target t. Arrows fly to the point where the target was (or will be - with the lead
        'lead', the "Ballistics" tech); with probability 1 - accuracy ('acc') - they miss, to the side."""
        if x is None:
            x, y = src.x, src.y - 10
        d = src.d
        if isinstance(t, Animal):
            point = None
        else:
            if isinstance(t, Unit):
                px, py = t.x, t.y
                p = src.p
                if p is not None and p.stat('lead', src.kind, 0) > 0 and self.dt > 0:
                    vx, vy = (t.x - t._px) / self.dt, (t.y - t._py) / self.dt
                    fl = math.hypot(px - x, py - y) / d.get('shot_speed', 260)
                    px, py = px + vx * fl, py + vy * fl
            else:
                px, py = t.center()
            acc = src.acc() if isinstance(src, Unit) else 1.0
            if acc < 1.0 and random.random() > acc:
                a = random.uniform(0, math.tau)
                r = random.uniform(0.5, 1.3) * TILE
                px, py = px + math.cos(a) * r, py + math.sin(a) * r
            point = (px, py)
        self.projectiles.append(Projectile(x, y, t, dmg, src, delay, point, d.get('blast', 0) * TILE,
                                           d.get('pierce', False)))
        if sound:
            self.emit('arrow', x, y, src.owner, src.kind)

    def impact(self, pr):
        """A projectile reached the aim point."""
        px, py = pr.point
        t, src = pr.target, pr.src
        if pr.blast > 0:
            self.blast(src, px, py, pr.blast, t, pr.dmg)
            return
        if t.alive and t not in pr.hit:
            if isinstance(t, Unit):
                if math.hypot(t.x - px, t.y - py) <= t.radius + 5:
                    self.damage(t, src, pr.dmg)
                    return
            elif t.dist_px(px, py) <= 6:
                self.damage(t, src, pr.dmg)
                return
        if pr.pierce:
            return
        # a miss: an arrow may hit another enemy at the landing point
        hrow = self.hmat[pr.owner]
        for u in self.units:
            if hrow[u.owner] and u.alive and abs(u.x - px) <= u.radius + 3 and abs(u.y - py) <= u.radius + 3:
                self.damage(u, src, self.calc_damage(src, u, True))
                return

    def blast(self, src, x, y, r, primary=None, dmg=None):
        """An explosion of radius r (pixels): damage to all units in the radius - foreign and own (like mangonels
        in the original), plus the target building and enemy buildings in the radius."""
        self.emit('blast', x, y, src.owner, src.kind)
        for u in self.units:
            if u is src or not u.alive:
                continue
            rr = r + u.radius
            if abs(u.x - x) > rr or abs(u.y - y) > rr or math.hypot(u.x - x, u.y - y) > rr:
                continue
            self.damage(u, src, dmg if u is primary and dmg is not None else self.calc_damage(src, u, True))
        hrow = self.hmat[src.owner]
        for b in self.buildings:
            if b.alive and not b.walk and (b is primary or hrow[b.owner]) and b.dist_px(x, y) <= r:
                self.damage(b, src, dmg if b is primary and dmg is not None else self.calc_damage(src, b, True))

    def pierce_hits(self, pr):
        """A scorpion's bolt pierces the enemies along the flight line (each one - once)."""
        hrow = self.hmat[pr.owner]
        for u in self.units:
            if not hrow[u.owner] or u is pr.target or not u.alive:
                continue
            if abs(u.x - pr.x) <= u.radius and abs(u.y - 8 - pr.y) <= u.radius + 2 and u not in pr.hit:
                pr.hit.add(u)
                self.damage(u, pr.src, self.calc_damage(pr.src, u, True))

    # ---- monks
    def convertible(self, m, t):
        """Whether monk m can convert t: a hostile unit; monks - after "Redemption" (the effect
        'convert_monk'), siege - after "Atonement" ('convert_siege'); buildings - no."""
        if not isinstance(t, Unit) or isinstance(t, Animal) or not t.alive or not self.hmat[m.owner][t.owner]:
            return False
        if t.d.get('unconvertible'):
            return False
        p = m.p
        if t.d.get('monk') and p.stat('convert_monk', m.kind, 0) <= 0:
            return False
        if 'siege' in unit_tags(t.kind) and p.stat('convert_siege', m.kind, 0) <= 0:
            return False
        return True

    def convert(self, t, m):
        """Unit t passes to monk m's owner (queue, targets, population - everything is recomputed)."""
        old, new = t.owner, m.owner
        t.stop()
        t.owner = new
        self._ug_src = None         # the owner masks in the unit grid are stale
        t.p = self.players[new]
        frac = t.hp / t.max_hp if t.max_hp else 1.0
        t.max_hp = t.p.stat('hp', t.kind, t.d['hp'])
        t.hp = max(1.0, t.max_hp * frac)
        t.faith_t = self.time + 62.0
        t.conv_t = 0.0
        t.scan_t = self.time + 1.0
        self.recount()
        gstats.on_convert(self, t, old, new)
        self.emit('convert', t.x, t.y, new, t.kind, old)
        if old == self.human:
            self.msg(i18n.t('msg.converted_lost', name=t.d['name']), (255, 110, 90))
            self.pings.append((t.x, t.y, self.time))
        elif new == self.human:
            self.msg(i18n.t('msg.converted_gained', name=t.d['name']), (170, 230, 150))

    def wounded_ally(self, m, radius):
        """The nearest wounded allied unit (not siege) for a monk to heal."""
        best, bd = None, radius
        arow = self.amat[m.owner]
        for u in self.units:
            if u is m or not arow[u.owner] or u.hp >= u.max_hp or not u.alive or u.cls == 'siege':
                continue
            if abs(u.x - m.x) > bd or abs(u.y - m.y) > bd:
                continue
            d = math.hypot(u.x - m.x, u.y - m.y)
            if d < bd:
                bd, best = d, u
        return best

    def build_age(self, p, kind):
        """From which age player p may lay a building kind. Nomad (AoE2): the first center - already in the Dark Age."""
        age = BUILDINGS[kind]['age']
        if kind == 'town_center' and getattr(self, 'nomad', False) and \
                not any(b.kind == 'town_center' and b.owner == p.id and b.alive for b in self.buildings):
            return 0
        return age

    def unit_state(self, p, kind):
        """(can_train, reason): the age and the needed techs (UNITS[kind]['req'])."""
        d = UNITS[kind]
        if not p.allows(kind):
            return False, i18n.t('msg.civ_unavailable')
        if d['age'] > p.age:
            return False, i18n.t('msg.need_age', age=AGE_NAMES[d['age']])
        for r in as_tuple(d.get('req', ())):
            if r not in p.techs:
                return False, i18n.t('msg.requires', name=TECHS[r]['name'])
        return True, ''

    def damage(self, target, attacker, dmg):
        if not target.alive:
            return
        if isinstance(target, Animal):
            if target.dead:
                return
            target.hp -= dmg
            target.hit_t = self.time
            self.emit('hit', target.x, target.y, target.owner, attacker.kind, target.kind)
            target.on_hit(self, attacker)
            if target.hp <= 0:
                self.emit('death', target.x, target.y, target.owner, target.kind)
                target.on_death()
                target.dead_t = self.time
            return
        target.hp -= dmg
        target.hit_t = self.time
        cx, cy = target.center()
        self.emit('hit', cx, cy, target.owner, attacker.kind, target.kind)
        to = target.owner
        if self.hostile(to, attacker.owner) and self.time - self.alert_t[to] > 10:
            self.alert_t[to] = self.time
            self.emit('attack_alert', cx, cy, to, target.kind)
            if to == self.human:
                self.msg(i18n.t('msg.under_attack'), (255, 110, 90))
                self.pings.append((cx, cy, self.time))
        if isinstance(target, Unit) and target.cls != 'vil' and target.state == 'idle' and attacker.alive \
                and attacker is not target and not self.allied(to, attacker.owner):
            if not ((target.d.get('bld_only') and isinstance(attacker, Unit)) or target.d.get('pack')) and \
                    not (getattr(attacker, 'naval', False) and not target.naval and target.d['rng'] <= 0):
                orders.engage(target, attacker)
        if target.hp <= 0:
            if attacker.owner >= 0 and attacker.owner != to:
                self.players[attacker.owner].kills += 1
                self.players[attacker.owner].kill_value += sum(target.d.get('cost', {}).values())
            gstats.on_death(self, target, attacker, not isinstance(target, Unit))
            if isinstance(target, Unit):
                target.alive = False
                target.release()
                # the unit itself - for drawing the death animation (kind, look, civilization)
                self.decals.append(['body', target.x, target.y, target.owner, self.time, target])
                self.emit('death', target.x, target.y, to, target.kind)
            else:
                self.remove_building(target)
                self.emit('destroy', cx, cy, to, target.kind)
                if to == self.human:
                    self.msg(i18n.t('msg.destroyed', name=target.d['name']), (255, 110, 90))

    # ---- the unit grid: a fast "who is nearby" search instead of walking all units
    def _build_ugrid(self):
        g = {}
        masks = {}          # cell -> a bit mask of the owners of the units in it (bit owner + 1; nature - bit 0)
        units = self.units
        C = UG_CELL
        for u in units:
            k = int(u.y // C) * 4096 + int(u.x // C)
            lst = g.get(k)
            if lst is None:
                g[k] = [u]
                masks[k] = 1 << (u.owner + 1)
            else:
                lst.append(u)
                masks[k] |= 1 << (u.owner + 1)
        self._ug = g
        self._ug_mask = masks
        self._ug_src = units
        self._ug_n = len(units)

    def hostile_mask(self, row):
        """A bit mask of the owners for which row[owner] is true (a row of hmat / beast_row)."""
        c = self._hm_cache.get(id(row))
        if c is not None and c[0] is row:
            return c[1]
        m = 0
        for o in range(-1, len(row) - 1):
            if row[o]:
                m |= 1 << (o + 1)
        self._hm_cache[id(row)] = (row, m)
        return m

    def units_in_rect(self, x0, y0, x1, y1, mask=None):
        """Candidates - units that MAY be in the rectangle [x0, x1] x [y0, y1] (pixels).
        mask - only cells that contain units of these owners (see hostile_mask), e.g. enemies.
        The exact check (alive, whose, distance) is done by the caller with the current coordinates.
        The grid is built lazily and rebuilt when the self.units list changes (it is reassembled
        at the end of every step), on a monk's conversion and when a building pushes units aside;
        per step units move by a couple of pixels - the UG_PAD margin.
        Units added after the grid was built (trained, landed) are always returned."""
        units = self.units
        if self._ug_src is not units:
            self._build_ugrid()
        g = self._ug
        C = UG_CELL
        cx0 = int((x0 - UG_PAD) // C)
        cx1 = int((x1 + UG_PAD) // C)
        out = []
        if mask is None:
            for cy in range(int((y0 - UG_PAD) // C), int((y1 + UG_PAD) // C) + 1):
                base = cy * 4096
                for k in range(base + cx0, base + cx1 + 1):
                    lst = g.get(k)
                    if lst is not None:
                        out += lst
        else:
            ms = self._ug_mask
            for cy in range(int((y0 - UG_PAD) // C), int((y1 + UG_PAD) // C) + 1):
                base = cy * 4096
                for k in range(base + cx0, base + cx1 + 1):
                    m = ms.get(k)
                    if m is not None and m & mask:
                        out += g[k]
        if len(units) > self._ug_n:
            out += units[self._ug_n:]
        return out

    def units_near(self, x, y, r, mask=None):
        """Candidates in a square +-r around a point (see units_in_rect)."""
        return self.units_in_rect(x - r, y - r, x + r, y + r, mask)

    def nearest_enemy(self, u, radius, buildings=True, minr=0, units=True):
        """The nearest enemy within a radius; minr - no closer than this (the minimum range of siege),
        units=False - only buildings (rams)."""
        best = None
        bd = radius
        hrow = self.hmat[u.owner] if u.owner >= 0 else self.beast_row
        fogged = u.owner == self.human
        if units:
            for o in self.units_near(u.x, u.y, radius * 1.5, self.hostile_mask(hrow)):
                if not hrow[o.owner] or not o.alive:
                    continue
                if o.naval and not u.naval and u.d['rng'] <= 0:    # ships cannot be reached by infantry and cavalry
                    continue
                d = abs(o.x - u.x) + abs(o.y - u.y)
                if d > bd * 1.5:
                    continue
                if fogged and not self.visible_px(o.x, o.y):
                    continue
                d = math.hypot(o.x - u.x, o.y - u.y)
                if d < bd and d >= minr:
                    bd, best = d, o
            if best is not None:
                return best
        if buildings:
            bd = radius
            for b in self.buildings:
                if not hrow[b.owner] or not b.alive or b.kind == 'farm' or b.d.get('wall'):
                    continue
                if fogged and not b.seen:
                    continue
                d = u.dist_to(b)
                if d < bd and d >= minr:
                    bd, best = d, b
        return best

    def nearest_beast(self, u, radius):
        """The nearest living predator (a wolf) within a radius (px) - soldiers attack it on their own."""
        best, bd = None, radius
        for a in self.animals:
            if a.den is None or a.dead or not a.alive:
                continue
            d = abs(a.x - u.x) + abs(a.y - u.y)
            if d > bd * 1.5:
                continue
            d = math.hypot(a.x - u.x, a.y - u.y)
            if d < bd and (u.owner != self.human or self.visible_px(a.x, a.y)):
                bd, best = d, a
        return best

    def nearest_enemy_unit_for_building(self, b, rng, minr=0):
        best = None
        bd = rng
        hrow = self.hmat[b.owner]
        x0, y0 = b.tx * TILE, b.ty * TILE
        pad = rng + UG_MAXR
        for o in self.units_in_rect(x0 - pad, y0 - pad, x0 + b.w * TILE + pad, y0 + b.h * TILE + pad,
                                    self.hostile_mask(hrow)):
            if not hrow[o.owner] or not o.alive:
                continue
            d = b.dist_px(o.x, o.y) - o.radius
            if d < bd and d >= minr:
                bd, best = d, o
        return best

    # ---- fog of war (for the human: everything his team sees is visible)
    def visible_px(self, x, y):
        tx, ty = int(x // TILE), int(y // TILE)
        if 0 <= tx < self.W and 0 <= ty < self.H:
            return self.vis[ty * self.W + tx] == 1
        return False

    def update_fog(self):
        W, H = self.W, self.H
        arow = self.amat[self.human]
        srcs = set()         # (cell x, cell y, radius): identical sources are counted once
        add = srcs.add
        for u in self.units:
            if arow[u.owner]:
                add((int(u.x // TILE), int(u.y // TILE), int(u.los())))
        for b in self.buildings:
            if arow[b.owner]:
                add((b.tx + b.w // 2, b.ty + b.h // 2, int(b.los())))
        for a in self.animals:
            if arow[a.owner] and not a.dead:
                add((int(a.x // TILE), int(a.y // TILE), a.los()))
        if srcs != self._fog_srcs:
            # the vision sources moved (by cells) - recompute the visibility
            self._fog_srcs = srcs
            vis = bytearray(W * H)
            exp = self.explored
            ones = _ONES
            spans = _FOG_SPANS
            for cx, cy, r in srcs:
                sp = spans.get(r)
                if sp is None:
                    r2 = (r + 0.5) ** 2
                    sp = spans[r] = [(dy, int(math.sqrt(max(0.0, r2 - dy * dy)))) for dy in range(-r, r + 1)]
                for dy, span in sp:
                    y = cy + dy
                    if y < 0 or y >= H:
                        continue
                    x0 = cx - span
                    if x0 < 0:
                        x0 = 0
                    x1 = cx + span
                    if x1 > W - 1:
                        x1 = W - 1
                    n = x1 - x0 + 1
                    if n > 0:
                        a = y * W + x0
                        vis[a:a + n] = ones[:n]
            # explored |= visible - one operation over the whole map (0/1 bytes)
            if getattr(self, 'reveal', 'normal') == 'all':      # lobby: "reveal all"
                vis = bytearray(b'\x01' * (W * H))
            exp[:] = (int.from_bytes(exp, 'little') | int.from_bytes(vis, 'little')).to_bytes(W * H, 'little')
            self.vis = vis
            self.fog_version += 1
        vis = self.vis
        for b in self.buildings:
            if not b.seen:
                for y in range(b.ty, b.ty + b.h):
                    a = y * W + b.tx
                    if any(vis[a:a + b.w]):
                        b.seen = True
                        break

    # ---- simulation step
    def recount(self):
        players = self.players
        pop = [0] * len(players)
        cap = [0] * len(players)
        for u in self.units:
            if u.alive:
                pop[u.owner] += 1 + len(u.cargo) if u.naval else 1     # + transport passengers
        for b in self.buildings:
            if b.garrison:
                pop[b.owner] += len(b.garrison)
            if b.progress >= 1.0:
                pl = players[b.owner]
                cap[b.owner] += b.d.get('pop', 0) + (pl.pop_extra.get(b.kind, 0) if pl.pop_extra else 0)
        for p, a, c in zip(players, pop, cap):
            p.pop = a
            p.cap = min(self.pop_limit + p.pop_bonus, c + p.pop_bonus + p.pop_keep)

    def separate(self):
        """Pushing apart overlapping units (and living animals; ships - naval.separate_ships).
        The grid is by map cells (a flat list, living between steps); a cell's neighbors (3x3 cells)
        are gathered once per cell and only if needed; lone units are skipped.
        A "calm" unit stands where it stood at the start of the previous push-apart, with the same radius, and then
        it intersected nobody. If all units of the 3x3 cells around are calm and none of them has yet
        moved in this pass, the distances to the neighbors are the same as last time - no intersections,
        the check is skipped. The traversal order and arithmetic are as before (the result is the same)."""
        W, H = self.W, self.H
        R = W + 2       # a grid row is wider than the map by 2 - neighbors by x do not "wrap around" to another row
        size = R * (H + 2)
        grid = self._sep_grid
        if grid is None or len(grid) != size:
            grid = self._sep_grid = [None] * size
            self._sep_moved = [0] * size
        moved = self._sep_moved         # moved[k] == pid - somebody moved in the 3x3 neighborhood of cell k
        pid = self._sep_pass = self._sep_pass + 1
        movers = [u for u in self.units if not u.naval]
        movers += [a for a in self.animals if not a.dead]
        keys = []
        occupied = []
        calm = {}               # cell -> all its units are calm
        for u in movers:
            x, y = u.x, u.y
            cx, cy = int(x // TILE), int(y // TILE)
            if not (0 <= cx < W and 0 <= cy < H):
                cx, cy = min(max(cx, 0), W - 1), min(max(cy, 0), H - 1)
            k = (cy + 1) * R + cx + 1
            keys.append(k)
            r = u.radius
            still = x == u._sep_x and y == u._sep_y and u._sep_clear and r == u._sep_r
            u._sep_x, u._sep_y, u._sep_r = x, y, r
            lst = grid[k]
            if lst is None:
                grid[k] = [u]
                occupied.append(k)
                calm[k] = still
            else:
                lst.append(u)
                if not still:
                    calm[k] = False
        offs = (-1 - R, -1, -1 + R, -R, 0, R, 1 - R, 1, 1 + R)     # the (dx, dy) order as in the old code
        nbc = {}                # cell -> 3x3 neighbors (None - the unit is alone in the neighborhood)
        calm3 = {}              # cell -> all units of the 3x3 around are calm
        cget = calm.get
        sqrt = math.sqrt
        terr, occ = self.terrain, self.occ
        for u, k in zip(movers, keys):
            c3 = calm3.get(k)
            if c3 is None:
                c3 = True
                for o in offs:
                    if cget(k + o) is False:
                        c3 = False
                        break
                calm3[k] = c3
            if c3 and moved[k] != pid:
                u._sep_clear = True
                continue
            if k in nbc:
                nb = nbc[k]
            else:
                nb = []
                for o in offs:
                    lst = grid[k + o]
                    if lst is not None:
                        nb += lst
                if len(nb) < 2:
                    nb = None
                nbc[k] = nb
            if nb is None:
                u._sep_clear = True
                continue
            ux, uy = u.x, u.y
            ur = u.radius
            px = py = 0.0
            clear = True
            for o in nb:
                if o is u:
                    continue
                ddx = ux - o.x
                ddy = uy - o.y
                mind = ur + o.radius - 3
                d2 = ddx * ddx + ddy * ddy
                if d2 < mind * mind:
                    clear = False
                    d = sqrt(d2)
                    if d < 0.01:
                        ang = random.uniform(0, math.tau)
                        ddx, ddy, d = math.cos(ang), math.sin(ang), 1.0
                    push = (mind - d) * 0.22
                    if o.owner == u.owner:
                        # own units give way to a walking one: a standing one steps aside, a walking one is barely deflected
                        um = u.state == 'move'
                        if um != (o.state == 'move'):
                            push *= 0.15 if um else 2.0
                    px += ddx / d * push
                    py += ddy / d * push
            u._sep_clear = clear
            if (px or py) and not (u.pack_t > 0 or not u.packed):
                if u.state in ('gather', 'build') and u.path == []:
                    px *= 0.3
                    py *= 0.3
                nx, ny = ux + px, uy + py
                tx, ty = int(nx // TILE), int(ny // TILE)
                if (0 <= tx < W and 0 <= ty < H and not terr[ty][tx] & 1 and occ[ty][tx] is None) or \
                        self.passable_for(tx, ty, u.owner):
                    u.x, u.y = nx, ny
                    for o in offs:
                        moved[k + o] = pid
        for k in occupied:
            grid[k] = None

    def update(self, dt):
        if self.winner is not None:
            return
        if len(self.events) > 4000:     # nobody takes the events (headless) - do not accumulate forever
            del self.events[:-500]
        self.time += dt
        self.dt = dt
        self.path_budget = 10
        for b in self.buildings:
            b.builders = 0
        for u in self.units:
            if u.alive:
                u.update(self, dt)
        for a in self.animals:
            if a.alive:
                a.update(self, dt)
        self.separate()
        naval.separate_ships(self)
        self.recount()
        for b in self.buildings:
            if b.alive:
                b.update(self, dt)
        for pr in self.projectiles:
            pr.update(self, dt)
        self.projectiles = [p for p in self.projectiles if p.alive]
        self.units = [u for u in self.units if u.alive]
        self.animals = [a for a in self.animals if a.alive]
        self.buildings = [b for b in self.buildings if b.alive]
        if self.nodes_dirty:
            self.nodes_dirty = False
            self.nodes = [n for n in self.nodes if n.alive]
        life = DECAL_LIFE
        self.decals = [d for d in self.decals if self.time - d[4] < life.get(d[0], 25)]
        self.pings = [p for p in self.pings if self.time - p[2] < 4]
        self.fog_t -= dt
        if self.fog_t <= 0:
            self.fog_t = 0.2
            self.update_fog()
        for f in WORLD_HOOKS['tick']:
            f(self, dt)
        for ai in self.ais:
            ai.update(dt)
        gstats.tick(self, dt)
        if self.treaty_end and self.time - dt < self.treaty_end <= self.time:
            self.update_teams()
            self.msg(i18n.t('msg.treaty_over'), (255, 200, 120))
        self.victory_t -= dt
        if self.victory_t <= 0:
            self.victory_t = 1.0
            self.check_victory()

    def check_victory(self):
        """A player is defeated when he has neither a town center nor villagers.
        The match ends when one team is left."""
        has = set()
        for b in self.buildings:
            if b.kind == 'town_center':
                has.add(b.owner)
            if any(u.kind == 'villager' for u in b.garrison):
                has.add(b.owner)
        for u in self.units:
            if u.kind == 'villager' or (u.naval and any(c.kind == 'villager' for c in u.cargo)):
                has.add(u.owner)
        for p in self.players:
            if p.alive and p.id not in has:
                p.alive = False
                gstats.on_defeat(self, p.id)
                sx, sy = self.starts[p.id]
                self.emit('defeat', sx * TILE, sy * TILE, p.id, None)
                if p.id == self.human:
                    self.msg(i18n.t('msg.you_defeated'), (255, 110, 90))
                else:
                    col = (255, 150, 130) if self.allied(self.human, p.id) else (170, 230, 150)
                    self.msg(i18n.t('msg.defeated', name=p.name), col)
        teams = {p.team for p in self.players if p.alive}
        special = match.victory_check(self, teams)      # time limit / score (lobby)
        if special is not None:
            self.winner = special
            self.emit('game_over', 0, 0, self.winner, None)
            return
        if len(teams) <= 1:
            self.winner = teams.pop() if teams else -1
            self.emit('game_over', 0, 0, self.winner, None)

    def resign(self, pid):
        """A player resigns (the F10 menu -> "Resign"): he is defeated at once; his army and buildings stay on the map."""
        p = self.players[pid]
        if not p.alive:
            return
        p.alive = False
        p.resigned = True
        gstats.on_defeat(self, pid)
        sx, sy = self.starts[pid]
        self.emit('defeat', sx * TILE, sy * TILE, pid, None)
        self.msg(i18n.t('msg.you_resigned') if pid == self.human else i18n.t('msg.resigned', name=p.name), (255, 110, 90))
        self.victory_t = 0.0
        self.check_victory()

    def human_won(self):
        return self.winner is not None and self.winner == self.players[self.human].team


from . import defense  # noqa: E402  (walls, gates, garrison; the module takes the classes from here)
from . import orders  # noqa: E402  (order queue, stances, formation, repair - game/orders.py)
# water and ships: the module imports the classes from here, so it is attached at the very end
from . import naval  # noqa: E402
from . import maps, mapgen  # noqa: E402  (DE maps: the list and the generator)
