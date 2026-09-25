"""AI on water: a dock, fishing ships, a war fleet, shelling the shore, landings on islands.

Attached to the regular AI (game/ai.py) only on water maps (World.map_type != 'land'):
  update(...)   - every half second: docks, ships, dock techs, the behavior of the fleet and transports;
  shore_fish(v) - shore fish for a villager (food next to a storage);
  ferry_mode()  - whether the army must be ferried by sea (the enemy is on another island);
  offense(army) - an offensive across water instead of a land one (boarding -> crossing -> landing -> combat).
"""
import math
import random

from .data import TILE, UNITS, TECHS
from .world import Building
from . import naval


class NavalAI:
    def __init__(self, ai):
        self.ai = ai
        self.w = ai.w
        self.pid = ai.pid
        self.p = ai.p
        self.dock_t = 0.0
        self.home_lc = None
        self.sea = None
        self.raid = None
        self.raid_t = 0.0
        self.ferry = {}             # id(transport) -> [state, squad, time]
        self.ferry_t = -99.0
        self.ferry_need = False
        self.wave = []

    # ---- geography
    def geo(self, base):
        w = self.w
        if self.home_lc is None:
            bx, by = base.center()
            self.home_lc = naval.land_comp(w, int(bx // TILE), int(by // TILE))
            _, _, wsize = naval.comps(w)
            seas = {}
            for (lx, ly, wx, wy, lc, wc) in naval.shores(w):
                if lc == self.home_lc:
                    seas[wc] = seas.get(wc, 0) + 1
            self.sea = max(seas, key=lambda c: wsize.get(c, 0)) if seas else None
            if self.sea is not None and wsize.get(self.sea, 0) < 60:
                self.sea = None

    def my_lc(self, u):
        return naval.land_comp(self.w, int(u.x // TILE), int(u.y // TILE))

    # ---- main step
    def update(self, vils, ships, blds, reserve, tc):
        w = self.w
        base = self.ai.base
        self.geo(base)
        if self.sea is None:
            return
        docks = [b for b in blds if b.kind == 'dock']
        ready = [b for b in docks if b.complete]
        self.build_docks(vils, docks, reserve)
        if not ready:
            return
        fishers = [s for s in ships if s.d.get('fisher')]
        navy = [s for s in ships if s.d['atk'] > 0]
        transports = [s for s in ships if s.cargo_cap() > 0]
        self.train(ready, fishers, navy, transports, vils, reserve)
        self.research(ready, fishers, navy, reserve)
        for s in fishers:
            if s.state == 'idle':
                d = ready[0]
                f = naval.find_fish(w, s, *d.center(), 70)
                if f is not None:
                    s.cmd_gather(f)
        self.fleet(navy, ready)
        for s in transports:
            if id(s) not in self.ferry and s.state == 'idle' and not s.cargo and random.random() < 0.05:
                dx, dy = ready[0].center()
                if math.hypot(s.x - dx, s.y - dy) > 6 * TILE:
                    s.cmd_move(dx + random.uniform(-40, 40), dy + random.uniform(-40, 40))

    # ---- docks
    def build_docks(self, vils, docks, reserve):
        w, p = self.w, self.p
        nv = len(vils)
        want = 0
        if nv >= 7:
            want = 1
        if p.age >= 2 and self.ai.diff >= 1 and nv >= 22:
            want = 2
        if len(docks) >= want or any(not b.complete for b in docks) or w.time < self.dock_t:
            return
        cost = p.cost_of('bld', 'dock')
        if not p.afford(cost, reserve if docks else None):
            return
        self.dock_t = w.time + 8
        spot = self.dock_spot(docks)
        if spot:
            self.ai.start_build('dock', spot, vils, 2 if not docks else 1)

    def dock_spot(self, docks):
        w = self.w
        bx, by = self.ai.base.center()
        btx, bty = bx / TILE, by / TILE
        cands = [(math.hypot(lx - btx, ly - bty), lx, ly, wx, wy) for (lx, ly, wx, wy, lc, wc) in naval.shores(w)
                 if lc == self.home_lc and wc == self.sea and w.passable(lx, ly)]
        cands.sort()
        for d, lx, ly, wx, wy in cands[:160]:
            if d < 6:
                continue
            if any(math.hypot(o.tx - wx, o.ty - wy) < 10 for o in docks):
                continue
            for tx in range(wx - 2, wx + 1):
                for ty in range(wy - 2, wy + 1):
                    if w.can_place('dock', tx, ty, self.pid, check_explored=False):
                        return tx, ty
        return None

    # ---- tutorial
    def train(self, ready, fishers, navy, transports, vils, reserve):
        w, p = self.w, self.p
        if p.pop >= p.cap:
            return
        free = [d for d in ready if len(d.queue) < 2]
        if not free:
            return
        queued = {}
        for d in ready:
            for kind, name in d.queue:
                if kind == 'unit':
                    queued[name] = queued.get(name, 0) + 1
        comp_fish = sum(1 for n in w.nodes if n.alive and n.kind in naval.FISH and
                        naval.fish_reachable(w, n, self.sea))
        want_f = min(comp_fish, (5, 8, 10, 10)[p.age] + self.ai.diff)
        nf = len(fishers) + queued.get('fishing_ship', 0)
        dock = min(free, key=lambda d: len(d.queue))
        # a transport - if the army has to be carried (after the first fishers - earlier than new fishers)
        if self.ferry_need and (nf >= 4 or p.age >= 1):
            nt = len(transports) + queued.get('transport_ship', 0)
            if nt < min(3, 1 + max(len(self.wave), self.ai.wave) // 6):
                cost = p.cost_of('unit', 'transport_ship')
                if p.afford(cost):
                    p.pay(cost)
                    dock.queue.append(('unit', 'transport_ship'))
                    return
        if nf < want_f:
            cost = p.cost_of('unit', 'fishing_ship')
            if p.afford(cost, reserve if len(vils) >= self.ai.age_need else None):
                p.pay(cost)
                dock.queue.append(('unit', 'fishing_ship'))
                return
        if p.age < 1 or len(vils) < 14:
            return
        hrow = w.hmat[self.pid]
        enemy_navy = [u for u in w.units if hrow[u.owner] and u.naval and u.d['atk'] > 0]
        want_n = int((0, 5, 9, 14)[p.age] * (0.6, 1.0, 1.3)[self.ai.diff]) + len(enemy_navy) // 2
        if self.ferry_need:
            want_n = max(3, want_n // 2)
        nn = len(navy) + sum(v for k, v in queued.items() if UNITS[k]['atk'] > 0)
        if nn >= min(want_n, 30):
            return
        opts = [u for u in dock.d.get('trains', []) if UNITS[u]['atk'] > 0 and UNITS[p.current(u)]['age'] <= p.age
                and p.allows(u) and p.allows(p.current(u))]
        if not opts:
            return
        galleys = sum(1 for u in enemy_navy if 'galley' in u.kind or u.kind == 'galleon')
        weights = {'galley': 4, 'fire_galley': 1 + galleys * 0.4, 'demolition_ship': 0.4 + galleys * 0.1,
                   'cannon_galleon': 2.0}
        pick = p.current(random.choices(opts, [weights.get(o, 1) for o in opts])[0])
        cost = p.cost_of('unit', pick)
        if p.afford(cost, reserve):
            p.pay(cost)
            dock.queue.append(('unit', pick))

    def research(self, ready, fishers, navy, reserve):
        w, p = self.w, self.p
        order = []
        if len(fishers) >= 4:
            order.append('gillnets')
        if len(navy) >= 4:
            order += ['careening', 'dry_dock']
        if len(fishers) >= 6 and p.age >= 3:
            order.append('shipwright')
        for name in order:
            if name not in TECHS:
                continue
            ok, _ = w.tech_state(p, name)
            if not ok:
                continue
            host = next((d for d in ready if name in d.d.get('techs', []) and len(d.queue) < 2), None)
            if host is None:
                continue
            cost = p.cost_of('tech', name)
            if p.afford(cost, reserve):
                p.pay(cost)
                host.queue.append(('tech', name))
                p.researching.add(name)
                return

    # ---- fleet
    def fleet(self, navy, ready):
        w = self.w
        if not navy:
            return
        hrow = w.hmat[self.pid]
        sea = self.sea
        enemy_ships = [u for u in w.units if hrow[u.owner] and u.naval and u.alive
                       and naval.water_comp(w, *u.tile()) == sea]
        mine = [s for s in w.units if s.owner == self.pid and s.naval and s.d['atk'] <= 0]
        # protect the docks, transports with people and fishers (no more than 6)
        my_stuff = [d.center() for d in ready] + [(s.x, s.y) for s in mine if s.cargo or id(s) in self.ferry] + \
                   [(s.x, s.y) for s in mine if s.d.get('fisher')][:6]
        # threats: enemy ships near our docks / fishers
        threats = [e for e in enemy_ships if any(math.hypot(e.x - x, e.y - y) < 12 * TILE for x, y in my_stuff)]
        if w.time >= self.raid_t or (self.raid is not None and not self.raid.alive):
            self.raid_t = w.time + 10
            self.raid = self.pick_raid(navy, enemy_ships, ready)
        strong = len(navy) >= (3, 4, 5)[self.ai.diff] + (1 if self.p.age >= 2 else 0)
        for s in navy:
            if s.state == 'attack' and s.target is not None and s.target.alive:
                if not getattr(s.target, 'naval', False) and threats and not s.d.get('siege'):
                    # strike the shore, but our own ships are in danger - the threat first
                    s.cmd_attack(min(threats, key=lambda e: (e.x - s.x) ** 2 + (e.y - s.y) ** 2))
                continue
            if threats and not s.d.get('siege'):
                s.cmd_attack(min(threats, key=lambda e: (e.x - s.x) ** 2 + (e.y - s.y) ** 2))
            elif strong and self.raid is not None and self.raid.alive:
                s.cmd_attack(self.raid)
            elif s.state == 'idle':
                dx, dy = ready[0].center()
                gx, gy = self.guard_point(dx, dy)
                if math.hypot(s.x - gx, s.y - gy) > 4 * TILE:
                    s.cmd_move(gx + random.uniform(-50, 50), gy + random.uniform(-50, 50))

    def guard_point(self, dx, dy):
        """A point at sea in front of the dock (toward the center of the body of water)."""
        w = self.w
        tx, ty = int(dx // TILE), int(dy // TILE)
        best = naval.nearest_water_tile(w, tx, ty, comp=self.sea, free=True)
        mx, my = w.W / 2, w.H / 2
        ang = math.atan2(my - ty, mx - tx)
        for d in (6, 5, 4, 3):
            x, y = int(tx + math.cos(ang) * d), int(ty + math.sin(ang) * d)
            if naval.water_free(w, x, y) and naval.water_comp(w, x, y) == self.sea:
                best = (x, y)
                break
        return (best[0] + 0.5) * TILE, (best[1] + 0.5) * TILE

    def pick_raid(self, navy, enemy_ships, ready):
        """Raid target: enemy ships, then docks, then buildings by the water within reach."""
        w = self.w
        dx, dy = ready[0].center()
        if enemy_ships:
            return min(enemy_ships, key=lambda e: (e.x - dx) ** 2 + (e.y - dy) ** 2)
        hrow = w.hmat[self.pid]
        probe = max(navy, key=lambda s: s.rng_tiles())
        blds = [b for b in w.buildings if hrow[b.owner] and b.alive and b.kind != 'farm']
        blds.sort(key=lambda b: (not b.d.get('water'), (b.center()[0] - dx) ** 2 + (b.center()[1] - dy) ** 2))
        for b in blds[:40]:
            if naval.can_reach(w, probe, b):
                return b
        return None

    def adjust_want(self, want, nv):
        fishers = sum(1 for u in self.w.units if u.owner == self.pid and u.naval and u.d.get('fisher'))
        if nv > 0 and fishers:
            shift = min(want['food'] * 0.6, fishers * 0.8 / nv)
            want['food'] -= shift
            want['wood'] += shift
        # the fleet and transports eat wood: excess gold - into the forest
        if self.p.res['gold'] > 400 and self.p.res['wood'] < 300:
            shift = want['gold'] * 0.5
            want['gold'] -= shift
            want['wood'] += shift

    # ---- villagers by the shore
    def shore_fish(self, v, bx, by):
        w = self.w
        n = w.find_resource(v, 'shore_fish', bx, by, 18)
        if n is None or not self.ai.has_drop_near('food', *n.center(), 5):
            return None
        if sum(1 for o in w.units if o.target is n) >= 2:
            return None
        return n

    # ---- landings
    def ferry_mode(self):
        """The enemy is unreachable by land - the army must be ferried (recomputed every 10 s)."""
        w = self.w
        if w.time - self.ferry_t < 10:
            return self.ferry_need
        self.ferry_t = w.time
        if self.home_lc is None or self.sea is None:
            self.ferry_need = False
            return False
        hrow = w.hmat[self.pid]
        tgt = self.ai.target
        reach = False
        for b in w.buildings:
            if hrow[b.owner] and (tgt is None or b.owner == tgt):
                cx, cy = b.tx + b.w // 2, b.ty + b.h // 2
                for x, y in ((b.tx - 1, cy), (b.tx + b.w, cy), (cx, b.ty - 1), (cx, b.ty + b.h)):
                    if naval.land_comp(w, x, y) == self.home_lc:
                        reach = True
                        break
            if reach:
                break
        self.ferry_need = not reach
        return self.ferry_need

    def enemy_goal(self):
        """Where to land: the target's main center (or any building)."""
        w = self.w
        hrow = w.hmat[self.pid]
        tgt = self.ai.target
        blds = [b for b in w.buildings if hrow[b.owner] and (tgt is None or b.owner == tgt)]
        if not blds:
            blds = [b for b in w.buildings if hrow[b.owner]]
        if not blds:
            return None
        tc = [b for b in blds if b.kind == 'town_center']
        return (tc or blds)[0]

    def offense(self, army):
        w, ai = self.w, self.ai
        home, landed = [], []
        for a in army:
            (home if self.my_lc(a) == self.home_lc else landed).append(a)
        # those who landed - into combat on the spot
        for a in landed:
            busy = a.state == 'attack' and a.target is not None and a.target.alive and \
                not getattr(a.target, 'naval', False)
            if not busy and not a.pending and a.state != 'move':
                t = self.nearest_enemy_on(a, self.my_lc(a))
                if t is not None:
                    a.cmd_attack(t)
        # a wave: as soon as enough have gathered at home - carry everyone while there is someone at home to carry
        if not self.wave:
            if w.time >= ai.first_attack and len(home) >= ai.wave:
                ai.wave = min(ai.wave + 4, 40)
                self.wave = list(home)
        else:
            self.wave += [a for a in home if a not in self.wave]
        ai.attacking = bool(self.wave or landed)
        if not self.wave:
            return
        goal = self.enemy_goal()
        self.wave = [a for a in self.wave if a.alive or getattr(a, 'aboard', None) is not None]
        transports = [s for s in w.units if s.owner == self.pid and s.naval and s.cargo_cap() > 0]
        waiting = [a for a in self.wave if a.alive and self.my_lc(a) == self.home_lc]
        assigned = set()
        for st in self.ferry.values():
            assigned.update(id(u) for u in st[1])
        for s in transports:
            st = self.ferry.get(id(s))
            if st is None:
                if s.cargo:
                    self.ferry[id(s)] = st = ['load', list(s.cargo), w.time - 100]
                else:
                    group = [a for a in waiting if id(a) not in assigned][:s.cargo_cap()]
                    if not group or goal is None:
                        continue
                    if naval.order_board(w, group, s):
                        self.ferry[id(s)] = ['load', group, w.time]
                        assigned.update(id(a) for a in group)
                    continue
            state, group, t0 = st
            if state == 'load':
                if w.time - t0 > 12 and int(w.time * 2) % 20 == 0:
                    # those who got distracted (combat, a crowd) - to the transport again
                    lost = [a for a in group if a.alive and a.state == 'idle' and a not in s.to_load]
                    if lost:
                        naval.order_board(w, lost + [a for a in s.to_load if a.alive], s)
                boarded = sum(1 for a in group if getattr(a, 'aboard', None) is s)
                alive = sum(1 for a in group if a.alive or getattr(a, 'aboard', None) is s)
                if s.cargo and (boarded >= alive or w.time - t0 > 50):
                    if goal is None:
                        continue
                    s.to_load = []
                    s.cmd_unload(*goal.center())
                    st[0], st[2] = 'sail', w.time
                elif not s.cargo and w.time - t0 > 50:
                    del self.ferry[id(s)]
            elif state == 'sail':
                if not s.cargo:
                    st[0], st[2] = 'back', w.time
                    d = next((b for b in w.buildings if b.owner == self.pid and b.kind == 'dock' and b.complete), None)
                    if d is not None:
                        s.cmd_move(*d.center())
                elif s.state == 'idle' or w.time - st[2] > 150:
                    if goal is not None:
                        s.cmd_unload(*goal.center())
                        st[2] = w.time
            elif state == 'back':
                if s.state == 'idle' or w.time - st[2] > 90:
                    del self.ferry[id(s)]
        for k in [k for k in self.ferry if not any(id(s) == k for s in transports)]:
            del self.ferry[k]
        # the wave is over: everyone was carried off (or died), nobody on the way
        if len(waiting) < 3 and not any(st[0] in ('load', 'sail') for st in self.ferry.values()):
            self.wave = []

    def nearest_enemy_on(self, a, lc):
        w = self.w
        hrow = w.hmat[self.pid]
        best, bd = None, 1e18
        for u in w.units:
            if hrow[u.owner] and not u.naval and naval.land_comp(w, int(u.x // TILE), int(u.y // TILE)) == lc:
                d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2
                if d < bd:
                    bd, best = d, u
        if best is not None and bd < (10 * TILE) ** 2:
            return best
        for b in w.buildings:
            if not hrow[b.owner] or not isinstance(b, Building) or b.d.get('water'):
                continue
            if naval.land_comp(w, b.tx, b.ty) != lc:
                continue
            cx, cy = b.center()
            d = (cx - a.x) ** 2 + (cy - a.y) ** 2
            if d < bd:
                bd, best = d, b
        return best
