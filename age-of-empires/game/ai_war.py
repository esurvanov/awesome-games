"""ИИ: ведение войны — сбор армии у точки сбора, волны атаки, марш с осадой, выбор целей, отступление,
оборона базы и «зачистка» (охота на последних жителей и здания, чтобы закончить партию).

Используется из ai.AI: self.war = WarPlanner(ai); каждые полсекунды AI.fight → war.update(army, vils, threats).
Состояния: 'rally' (копим у точки сбора) → 'march' (строем идём к рубежу перед целью, темп — по самым
медленным, т. е. осаде) → 'engage' (бой: юниты бьют ближайших военных врагов, иначе — цель; осада — здания)
→ 'retreat' (при тяжёлых потерях — назад к точке сбора) → 'rally'.
Атака начинается, когда сила армии ≥ ratio × известной силы врага (профиль сложности ai.prof).
Союзников не трогаем: все цели — только через матрицу враждебности w.hmat.
"""
import math
import random

from .data import TILE, UNITS
from .world import Unit, Building

TOWERS = ('tower', 'guard_tower', 'keep', 'bombard_tower')
FORTS = TOWERS + ('castle',)
ECO_BLDS = ('mill', 'lumber_camp', 'mining_camp', 'dock', 'market', 'town_center')
_VAL = {}


def value(kind):
    """Цена юнита (сумма ресурсов) — мера «силы» для сравнения армий."""
    v = _VAL.get(kind)
    if v is None:
        d = UNITS[kind]
        v = sum(d['cost'].values())
        if d['cls'] == 'siege':
            v *= 0.35 if (d.get('bld_only') or d.get('pack')) else 0.8
        elif d.get('monk'):
            v *= 0.5
        _VAL[kind] = v = max(20.0, float(v))
    return v


def strength(units):
    s = 0.0
    for u in units:
        s += value(u.kind) * (0.4 + 0.6 * u.hp / max(1.0, u.max_hp))
    return s


def is_fighter(u):
    return u.cls != 'vil' and not u.d.get('civil') and not u.naval


def siege_like(u):
    return bool(u.d.get('bld_only') or u.d.get('pack'))


def bld_breaker(u):
    """Осада, способная ломать здания (таран, требушет, бомбарда)."""
    return bool(u.d.get('bld_only') or u.d.get('pack') or u.kind == 'bombard_cannon')


class WarPlanner:
    def __init__(self, ai):
        self.ai = ai
        self.w = ai.w
        self.state = 'rally'
        self.group = []
        self.obj = None
        self.flag = None
        self.stage = None
        self.v0 = 1.0
        self.t_state = 0.0
        self.next_wave = 0.0
        self.ready_t = None         # с какого времени армия «готова», но ждёт осаду
        self.wait_t = None          # с какого времени армии хватает по численности (терпение — prof['patience'])
        self.waves = 0
        self.order_t = {}           # id(юнит) → время последнего приказа
        self.tick_n = 0
        self.hunt = False
        self.broken = False
        self.broken_t = -99.0
        self.avoid = []             # замки врага, к которым без осады не лезем (зачистка)

    # ---- служебное
    def set_state(self, s):
        self.state = s
        self.t_state = self.w.time

    def order(self, a, now, gap=2.5):
        """Можно ли снова отдавать приказ юниту (не дёргаем путь каждые полсекунды)."""
        t = self.order_t.get(id(a), -99.0)
        if now - t < gap:
            return False
        self.order_t[id(a)] = now
        return True

    def rally_point(self):
        ai = self.ai
        bx, by = ai.base.center()
        if ai.target is None:
            return bx, by + 4 * TILE
        ex, ey = self.w.starts[ai.target]
        dx, dy = ex * TILE - bx, ey * TILE - by
        d = math.hypot(dx, dy) or 1
        return bx + dx / d * 7 * TILE, by + dy / d * 7 * TILE

    def enemy_strength(self):
        """Известная сила врага: армия цели + треть армий остальных врагов."""
        w, ai = self.w, self.ai
        hrow = w.hmat[ai.pid]
        s = 0.0
        for u in w.units:
            if hrow[u.owner] and is_fighter(u):
                s += value(u.kind) * (1.0 if u.owner == ai.target else 0.33)
        return s

    @staticmethod
    def centroid(units):
        if not units:
            return None
        xs = sorted(u.x for u in units)
        ys = sorted(u.y for u in units)
        return xs[len(xs) // 2], ys[len(ys) // 2]

    # ---- главный шаг
    def update(self, army, vils, threats):
        ai, w = self.ai, self.w
        now = w.time
        self.tick_n += 1
        fighters = [a for a in army if is_fighter(a)]
        gset = {id(a) for a in self.group}
        self.group = [a for a in fighters if id(a) in gset]
        gset = {id(a) for a in self.group}
        home = [a for a in fighters if id(a) not in gset]
        if len(self.order_t) > 600:
            alive = {id(a) for a in fighters}
            self.order_t = {k: v for k, v in self.order_t.items() if k in alive}

        # ---- оборона базы
        if threats:
            tv = strength(threats)
            if self.state in ('march', 'engage'):
                gs = strength(self.group)
                hs = strength([a for a in home if not siege_like(a)])
                sieged = any(bld_breaker(u) for u in threats)
                # отзываем армию, только если дома не справиться: набег мелкий — размен базами выгоднее
                if tv > 1.2 * hs + 300 and (tv >= 0.5 * gs or sieged or self.state == 'march'):
                    self.recall()
            if self.state == 'retreat':
                home = home + self.group
            self.defend(home, vils, threats)
            ai.attacking = self.state in ('march', 'engage')
            if self.state not in ('march', 'engage'):
                return
        else:
            for v in vils:
                if v.state == 'attack' and (v.target is None or not v.target.alive or not isinstance(v.target, Unit)):
                    v.stop()

        # ---- морская высадка — у морской части ИИ
        if ai.naval is not None and ai.naval.ferry_mode():
            self.group = []
            self.set_state('rally')
            ai.naval.offense(fighters)
            return

        st = self.state
        if st == 'rally':
            self.gather(home, now)
            self.maybe_commit(home, now)
        elif st == 'march':
            self.gather(home, now)
            self.march(now)
        elif st == 'engage':
            self.reinforce(home, now)
            self.engage(now)
        elif st == 'retreat':
            self.gather(home, now)
            rx, ry = self.rally_point()
            back = sum(1 for a in self.group if math.hypot(a.x - rx, a.y - ry) < 8 * TILE)
            if now - self.t_state > 40 or back >= 0.7 * len(self.group):
                self.group = []
                self.set_state('rally')
        ai.attacking = self.state in ('march', 'engage')
        ai.army.lead_monks(self.group if self.group else home)

    # ---- оборона
    def defend(self, home, vils, threats):
        now = self.w.time
        for a in home:
            if siege_like(a) or a.d.get('monk'):
                continue
            if a.state in ('attack', 'convert') and a.target in threats:
                continue
            if a.state == 'garrison':
                continue
            if not self.order(a, now, 1.0):
                continue
            t = min(threats, key=lambda o: (o.x - a.x) ** 2 + (o.y - a.y) ** 2)
            a.cmd_attack(t)
        # мангонели/скорпионы дома тоже стреляют по толпе
        for a in home:
            if siege_like(a) or not a.d.get('rng') or a.cls != 'siege':
                continue
            if a.state != 'attack' and self.order(a, now, 2.0):
                t = min(threats, key=lambda o: (o.x - a.x) ** 2 + (o.y - a.y) ** 2)
                a.cmd_attack(t)
        n_def = sum(1 for a in home if not siege_like(a))
        if n_def < 2 and len(threats) <= 3:
            for t in threats:
                near = [v for v in vils if (v.x - t.x) ** 2 + (v.y - t.y) ** 2 < (4 * TILE) ** 2]
                for v in near[:4]:
                    if v.state != 'attack':
                        v.cmd_attack(t)

    def recall(self):
        rx, ry = self.rally_point()
        bx, by = self.ai.base.center()
        for a in self.group:
            if a.d.get('pack'):
                a.cmd_move(rx, ry)
                continue
            a.cmd_move(bx + random.uniform(-60, 60), by + random.uniform(-60, 60))
        self.set_state('retreat')
        self.next_wave = self.w.time + 30

    # ---- сбор
    def gather(self, home, now):
        rx, ry = self.rally_point()
        for a in home:
            if a.state == 'idle' and math.hypot(a.x - rx, a.y - ry) > 5 * TILE and self.order(a, now, 4.0):
                a.cmd_move(rx + random.uniform(-50, 50), ry + random.uniform(-50, 50))

    def maybe_commit(self, home, now):
        ai, p = self.ai, self.ai.p
        prof = ai.prof
        if now < ai.first_attack or now < self.next_wave or ai.target is None:
            return
        combat = [a for a in home if not a.d.get('monk')]
        n = len([a for a in combat if not siege_like(a)])
        minw = prof['wave_min'][p.age]
        # у цели не осталось ни центра, ни замка — добить хватит и небольшого отряда
        if self.enemy_broken():
            minw = min(minw, 4)
        if n < minw:
            self.ready_t = None
            self.wait_t = None
            return
        if self.wait_t is None:
            self.wait_t = now
        my = strength(combat)
        en = self.enemy_strength()
        maxed = p.pop >= min(p.cap, 200 + p.pop_bonus) - 4 and p.pop >= 120
        big = n >= 3 * minw and my >= 0.6 * en
        # долго стоим «готовыми», а перевеса всё нет — идём при сопоставимых силах
        patient = now - self.wait_t > prof['patience'] and my >= 0.65 * en
        broken = self.enemy_broken() and my >= 0.5 * en
        if not (my >= prof['ratio'] * en or maxed or big or patient or broken):
            self.ready_t = None
            return
        # в Замках и позже ждём осадное орудие (не дольше 100 с), если мастерская есть
        if p.age >= 2 and not any(bld_breaker(a) for a in combat):
            has_ws = any(b.owner == ai.pid and b.complete and b.kind in ('siege_workshop', 'castle')
                         for b in self.w.buildings)
            if has_ws and not maxed:
                if self.ready_t is None:
                    self.ready_t = now
                if now - self.ready_t < 100:
                    return
        self.ready_t = None
        self.wait_t = None
        self.launch(combat + [a for a in home if a.d.get('monk')], now)

    def launch(self, units, now):
        self.group = list(units)
        self.v0 = max(1.0, strength(self.group))
        self.waves += 1
        self.ai.wave = min(self.ai.wave + 4, 40)
        self.ai.target = self.ai.pick_target(self.ai.base)
        c = self.centroid([a for a in self.group if not siege_like(a)] or self.group)
        self.obj = self.choose_obj(*c)
        if self.obj is None:
            self.group = []
            return
        self.flag = c
        self.set_state('march')
        self.prog_t = now

    def enemy_broken(self):
        """У цели нет ни центра, ни замка (пересчёт раз в 5 с)."""
        w = self.w
        if w.time - self.broken_t < 5:
            return self.broken
        self.broken_t = w.time
        owners = set(self.target_players())
        self.broken = bool(owners) and not any(b.owner in owners and b.kind == 'town_center' for b in w.buildings)
        return self.broken

    # ---- выбор цели
    def target_players(self):
        w, ai = self.w, self.ai
        hrow = w.hmat[ai.pid]
        if ai.target is not None and hrow[ai.target] and w.players[ai.target].alive:
            return [ai.target]
        return [p.id for p in w.players if hrow[p.id] and p.alive]

    def choose_obj(self, cx, cy):
        w, ai = self.w, self.ai
        hrow = w.hmat[ai.pid]
        owners = set(self.target_players())
        if not owners:
            return None
        siege = sum(1 for a in self.group if bld_breaker(a))
        gs = strength(self.group)
        blds = [b for b in w.buildings if b.owner in owners and b.alive and not b.d.get('wall')
                and not b.d.get('water')]
        # «хребет» врага: центры и замки
        # без центров враг проигрывает, как только кончатся жители — охотимся на них (замок без осады обходим)
        core = [b for b in blds if b.kind == 'town_center' or (b.kind == 'castle' and siege >= 2)]
        self.hunt = not core
        self.avoid = [b for b in blds if b.kind == 'castle' and siege < 2]
        if self.hunt:
            vils = [u for u in w.units if u.owner in owners and hrow[u.owner] and u.cls == 'vil' and not u.naval]
            vils = [u for u in vils if not any(c.dist_px(u.x, u.y) < 9 * TILE for c in self.avoid)]
            cands = vils or [b for b in blds if b.kind != 'farm' and b not in self.avoid]
            if not cands:
                cands = [b for b in blds] or [u for u in w.units if u.owner in owners and not u.naval]
            if not cands:
                return None
            return min(cands, key=lambda e: (e.center()[0] - cx) ** 2 + (e.center()[1] - cy) ** 2)
        best, bs = None, 1e18
        for b in blds:
            bx, by = b.center()
            d = math.hypot(bx - cx, by - cy) / TILE
            k = b.kind
            if k in TOWERS:
                pri = 0 if d < 16 else 4
            elif k == 'castle':
                pri = 1 if siege >= 2 or (siege >= 1 and gs > 2500) else 9
            elif k == 'town_center':
                pri = 1 if siege >= 1 or gs > 2000 else 3
            elif b.d.get('trains') and d < 14:
                pri = 2
            elif k in ECO_BLDS:
                pri = 3
            elif k == 'farm':
                pri = 6
            else:
                pri = 5
            s = pri * 30 + d
            if s < bs:
                bs, best = s, b
        return best

    # ---- марш
    def march(self, now):
        w = self.w
        grp = self.group
        if len(grp) < 2:
            self.end_wave(now)
            return
        if self.obj is None or not self.obj.alive:
            c = self.centroid(grp)
            self.obj = self.choose_obj(*c)
            if self.obj is None:
                self.end_wave(now)
                return
        ox, oy = self.obj.center()
        fx, fy = self.flag
        bx, by = self.ai.base.center()
        dx, dy = ox - bx, oy - by
        d = math.hypot(dx, dy) or 1
        stx, sty = ox - dx / d * 9 * TILE, oy - dy / d * 9 * TILE
        # враги рядом с отрядом — в бой
        c = self.centroid([a for a in grp if not siege_like(a)] or grp)
        hrow = w.hmat[self.ai.pid]
        mask = w.hostile_mask(hrow)
        for u in w.units_in_rect(c[0] - 8 * TILE, c[1] - 8 * TILE, c[0] + 8 * TILE, c[1] + 8 * TILE, mask):
            if hrow[u.owner] and u.alive and not u.naval:
                self.set_state('engage')
                return
        rest = math.hypot(stx - fx, sty - fy)
        if rest < TILE or now - self.t_state > 240:
            self.set_state('engage')
            return
        near = sum(1 for a in grp if math.hypot(a.x - fx, a.y - fy) < 5 * TILE)
        if near >= 0.6 * len(grp) or now - self.prog_t > 30:
            spd = min(a.speed() for a in grp) * 0.9
            step = min(rest, spd * 0.5 + (2 * TILE if near == len(grp) else 0))
            if now - self.prog_t > 30:
                step = min(rest, 6 * TILE)
            fx += (stx - fx) / rest * step
            fy += (sty - fy) / rest * step
            self.flag = (fx, fy)
            self.prog_t = now
        for a in grp:
            if math.hypot(a.x - fx, a.y - fy) > 2.5 * TILE and a.state in ('idle', 'move', 'attack') \
                    and self.order(a, now, 3.0):
                a.cmd_move(fx + random.uniform(-45, 45), fy + random.uniform(-45, 45))

    # ---- бой
    def reinforce(self, home, now):
        n = [a for a in home if not a.d.get('monk')]
        # подкрепление — пачкой и только к живой волне; растаявшую волну не кормим по одному.
        # Явный перевес (или враг без армии) — дожимаем: всё новое сразу вперёд
        gs = strength(self.group)
        ahead = gs + strength(n) >= 2.0 * self.enemy_strength()
        if len(n) >= (2 if self.hunt or ahead else 5) and (self.hunt or ahead or gs >= 0.45 * self.v0):
            self.group += n
            self.v0 = max(self.v0, strength(self.group))

    def end_wave(self, now):
        rx, ry = self.rally_point()
        for a in self.group:
            if a.alive and a.state == 'idle':
                a.cmd_move(rx + random.uniform(-50, 50), ry + random.uniform(-50, 50))
        self.group = []
        self.obj = None
        self.set_state('rally')
        # волна дошла до конца цели, а врагу нечем ответить — следующая почти сразу
        quick = self.enemy_strength() < 0.5 * max(1.0, strength(self.group))
        self.next_wave = now + self.ai.prof['wave_gap'] * (0.15 if quick else 0.5)

    def engage(self, now):
        w, ai = self.w, self.ai
        grp = self.group
        combat = [a for a in grp if not a.d.get('monk')]
        if not combat or sum(1 for a in combat if not siege_like(a)) == 0 and \
                not any(bld_breaker(a) for a in combat):
            self.end_wave(now)
            return
        c = self.centroid([a for a in combat if not siege_like(a)] or combat)
        hrow = w.hmat[ai.pid]
        mask = w.hostile_mask(hrow)
        # отступление: армия растаяла, а рядом с ней враг сильнее
        gs = strength(combat)
        if now - self.t_state > 10 and gs < 0.4 * self.v0 and not self.hunt:
            local = [u for u in w.units_in_rect(c[0] - 10 * TILE, c[1] - 10 * TILE, c[0] + 10 * TILE,
                                                 c[1] + 10 * TILE, mask)
                     if hrow[u.owner] and u.alive and is_fighter(u)]
            forts = sum(1 for b in w.buildings if hrow[b.owner] and b.kind in FORTS and b.complete
                        and b.dist_px(*c) < 10 * TILE)
            en = self.enemy_strength()
            if strength(local) + forts * 500 > 1.2 * gs or (gs < 0.25 * self.v0 and gs < 2.0 * en):
                # проигрываем (или от волны почти ничего не осталось) — назад, копить следующую
                self.recall()
                self.next_wave = now + ai.prof['wave_gap']
                return
        if self.obj is None or not self.obj.alive or getattr(self.obj, 'dead', False) or \
                not hrow[self.obj.owner] or (self.tick_n % 20 == 0):
            self.obj = self.choose_obj(*c)
            if self.obj is None:
                ai.target = ai.pick_target(ai.base)
                self.obj = self.choose_obj(*c)
            if self.obj is None:
                self.end_wave(now)
                return
        obj = self.obj
        taken = {}
        bk = [a for a in combat if bld_breaker(a)]
        breakers = self.centroid(bk) if bk else None
        for a in combat:
            if not self.order(a, now, 1.5):
                continue
            t = a.target if a.state == 'attack' else None
            alive_t = t is not None and t.alive and not getattr(t, 'dead', False) and hrow[t.owner]
            if bld_breaker(a):
                if alive_t and isinstance(t, Building) and (t.kind in FORTS or t is obj):
                    continue
                b = self.siege_target(a, obj, c)
                if b is not None and b is not t:
                    a.cmd_attack(b)
                continue
            if a.cls == 'siege':
                # мангонели, скорпионы: по юнитам рядом, иначе — за отрядом
                e = self.near_enemy(a, 9 * TILE, mask, hrow, military=True)
                if e is not None:
                    if not alive_t:
                        a.cmd_attack(e)
                elif math.hypot(a.x - c[0], a.y - c[1]) > 4 * TILE and a.state != 'attack':
                    a.cmd_move(c[0] + random.uniform(-40, 40), c[1] + random.uniform(-40, 40))
                continue
            if alive_t and isinstance(t, Unit) and not t.naval:
                continue
            e = self.near_enemy(a, 7 * TILE, mask, hrow, military=True) or \
                self.near_enemy(a, 6 * TILE, mask, hrow, military=False)
            if e is not None:
                a.cmd_attack(e)
                continue
            if self.hunt:
                h = self.hunt_target(a, taken)
                if h is not None:
                    if h is not t:
                        a.cmd_attack(h)
                    continue
            far = math.hypot(a.x - c[0], a.y - c[1]) > 14 * TILE
            if far and math.hypot(a.x - obj.center()[0], a.y - obj.center()[1]) > 12 * TILE:
                a.cmd_move(c[0] + random.uniform(-40, 40), c[1] + random.uniform(-40, 40))
                continue
            if obj.kind in FORTS and isinstance(obj, Building) and breakers:
                # замок/башню ломает осада; остальные прикрывают её, не подставляясь под стрелы
                sx, sy = breakers
                if alive_t and isinstance(t, Building) and t.kind in FORTS:
                    a.cmd_move(sx + random.uniform(-50, 50), sy + random.uniform(-50, 50))
                elif math.hypot(a.x - sx, a.y - sy) > 4 * TILE and a.state != 'attack':
                    a.cmd_move(sx + random.uniform(-50, 50), sy + random.uniform(-50, 50))
                continue
            if alive_t and isinstance(t, Building) and (t is obj or t.kind in TOWERS):
                continue
            a.cmd_attack(obj)

    def near_enemy(self, a, r, mask, hrow, military=True):
        best, bd = None, r * r
        w = self.w
        for u in w.units_in_rect(a.x - r, a.y - r, a.x + r, a.y + r, mask):
            if not hrow[u.owner] or not u.alive or u.naval or getattr(u, 'inside', None) is not None:
                continue
            if military and not is_fighter(u):
                continue
            if not military and u.cls != 'vil' and not u.d.get('civil'):
                continue
            d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2
            if d < bd:
                bd, best = d, u
        return best

    def siege_target(self, a, obj, c):
        """Цель тарана/требушета: башни и замки рядом, затем цель волны, затем ближайшее здание."""
        w = self.w
        hrow = w.hmat[self.ai.pid]
        best, bs = None, 1e18
        rng = 18 * TILE if a.d.get('pack') else 10 * TILE
        for b in w.buildings:
            if not hrow[b.owner] or not b.alive or b.d.get('wall') or b.kind == 'farm' or b.d.get('water'):
                continue
            d = b.dist_px(a.x, a.y)
            if d > 30 * TILE:
                continue
            if b.kind in FORTS and d < rng:
                s = d - 40 * TILE
            elif b is obj:
                s = d - 20 * TILE
            elif b.kind in ('town_center', 'castle'):
                s = d - 10 * TILE
            else:
                s = d
            if s < bs:
                bs, best = s, b
        if best is None and isinstance(obj, Building):
            best = obj
        return best

    def hunt_target(self, a, taken):
        """Зачистка: ближайший вражеский житель (не больше 4 охотников на одного), иначе здание."""
        w = self.w
        hrow = w.hmat[self.ai.pid]
        best, bd = None, 1e18
        for u in w.units:
            if hrow[u.owner] and u.alive and not u.naval and (u.cls == 'vil' or u.d.get('civil')):
                if taken.get(id(u), 0) >= 4:
                    continue
                if any(c.dist_px(u.x, u.y) < 9 * TILE for c in self.avoid):
                    continue
                d = (u.x - a.x) ** 2 + (u.y - a.y) ** 2
                if d < bd:
                    bd, best = d, u
        if best is None:
            for b in w.buildings:
                if hrow[b.owner] and b.alive and not b.d.get('wall') and b.kind != 'farm' and not b.d.get('water'):
                    if taken.get(id(b), 0) >= 8:
                        continue
                    d = (b.center()[0] - a.x) ** 2 + (b.center()[1] - a.y) ** 2
                    if d < bd:
                        bd, best = d, b
        if best is not None:
            taken[id(best)] = taken.get(id(best), 0) + 1
        return best
