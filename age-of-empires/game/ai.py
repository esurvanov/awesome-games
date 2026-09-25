"""Компьютерный противник.

План развития по эпохам и уровню сложности (PROFILES): сколько жителей держать в каждой эпохе, при скольких
жителях и не раньше какой минуты переходить в следующую, сколько производственных зданий и центров,
когда строить замок, когда и какой силой нападать. Центры обучают жителей без перерыва; дома — с запасом по
темпу производства; жители распределяются по ресурсам по потребностям на ближайшие ~2 минуты (жители,
эпоха, армия, стройка, камень на замок, технология, на которую копим). Излишки — на рынок (eco_ai).
Армия: состав и технологии — ai_army.ArmyPlanner, война (волны, цели, отступление, зачистка) — ai_war.WarPlanner,
оборона (частокол, набат, гарнизон) — ai_defense, флот — naval_ai.
"""
import math
import random
from collections import Counter

from .data import TILE, RES, BUILDINGS, TECHS, AGE_TECHS, AGE_REQ, cost_add
from .world import Building, Node
from . import ai_defense
from . import eco_ai
from .ai_army import ArmyPlanner, line_of
from .ai_war import WarPlanner

M = 60.0
# Уровни сложности: 0 — лёгкий, 1 — нормальный, 2 — сложный. Кортежи по эпохам (0 — Тёмные века … 3 — Имперская).
PROFILES = {
    0: dict(vils=(18, 25, 32, 40), age_vils=(18, 25, 32), age_min=(15 * M, 31 * M, 52 * M), tc_extra=(0, 0),
            first_attack=25 * M, ratio=1.6, wave_min=(99, 99, 10, 14), wave_gap=480, army_vils=(99, 18, 24, 28),
            castles=(0, 0, 0, 1), prod=(1, 2, 3, 4), workshops=(0, 0, 1, 1), spend=(0, 150, 450, 700), patience=420, min_army=(0, 0, 6, 10), tech_gap=(0, 60, 120, 120),
            stone_early=False),
    1: dict(vils=(21, 33, 50, 65), age_vils=(20, 28, 42), age_min=(11.5 * M, 24 * M, 40 * M), tc_extra=(1, 1),
            first_attack=14 * M, ratio=1.25, wave_min=(99, 6, 10, 14), wave_gap=240, army_vils=(99, 20, 27, 32),
            castles=(0, 0, 1, 2), prod=(1, 2, 4, 6), workshops=(0, 0, 1, 1), spend=(0, 350, 900, 1400), patience=240, min_army=(0, 0, 12, 20), tech_gap=(0, 40, 75, 75),
            stone_early=True),
    2: dict(vils=(22, 36, 70, 95), age_vils=(21, 28, 40), age_min=(0, 0, 0), tc_extra=(1, 1),
            first_attack=10.5 * M, ratio=0.95, wave_min=(99, 5, 9, 14), wave_gap=120, army_vils=(99, 19, 27, 34),
            castles=(0, 0, 1, 2), prod=(1, 3, 6, 8), workshops=(0, 0, 1, 2), spend=(0, 500, 1300, 2000), patience=150, min_army=(0, 0, 14, 35), tech_gap=(0, 30, 55, 55),
            stone_early=True),
}


def _lerp(a, b, t):
    if isinstance(a, bool):
        return a if t < 0.5 else b
    if isinstance(a, dict):
        return {k: _lerp(a[k], b[k], t) for k in a}
    if isinstance(a, tuple):
        return tuple(_lerp(x, y, t) for x, y in zip(a, b))
    v = a + (b - a) * t
    return int(round(v)) if isinstance(a, int) and isinstance(b, int) else v


def _stronger(base, **ch):
    d = dict(base)
    d.update(ch)
    return d


# 6 уровней как в AoE2 DE (лобби, match.AI_LEVELS): Легчайший · Стандартный · Средний · Сложный · Сложнейший · Экстрим.
# 0 = прежний «лёгкий», 2 = «нормальный», 3 = «сложный»; 1 — середина между ними; 4–5 — сильнее «сложного»
# (раньше в атаку, чаще волны, больше жителей и производства; бонус добычи — match.LEVEL_GATHER).
LEVELS = [
    PROFILES[0],
    _lerp(PROFILES[0], PROFILES[1], 0.5),
    PROFILES[1],
    PROFILES[2],
    _stronger(PROFILES[2], vils=(24, 40, 78, 105), age_vils=(20, 27, 38), first_attack=9.5 * M, ratio=0.85,
              wave_gap=100, prod=(1, 3, 7, 9), spend=(0, 600, 1500, 2300), patience=130, min_army=(0, 0, 16, 40),
              tech_gap=(0, 25, 45, 45), workshops=(0, 0, 2, 2)),
    _stronger(PROFILES[2], vils=(25, 42, 85, 115), age_vils=(20, 26, 36), first_attack=8.5 * M, ratio=0.75,
              wave_min=(99, 5, 8, 12), wave_gap=80, prod=(2, 4, 8, 10), spend=(0, 700, 1800, 2600), patience=110,
              min_army=(0, 0, 18, 45), tech_gap=(0, 20, 35, 35), workshops=(0, 0, 2, 3), castles=(0, 0, 1, 3)),
]
LEVEL_OF_DIFF = {0: 0, 1: 2, 2: 3}
TIER_OF_LEVEL = (0, 0, 1, 2, 2, 2)      # для старых проверок «diff >= 1 / 2» в ai_*.py, naval_ai.py

PROD = ('barracks', 'archery_range', 'stable')
DROPS = ('lumber_camp', 'mill', 'mining_camp')


# ============================================================ ИИ
class AI:
    def __init__(self, w, pid, diff, level=None):
        """diff — прежние 3 уровня (0–2); level — уровень DE 0–5 (важнее diff, если задан)."""
        self.w = w
        self.pid = pid
        self.p = w.players[pid]
        if level is None:
            level = LEVEL_OF_DIFF.get(diff, 2)
        self.level = max(0, min(len(LEVELS) - 1, level))
        self.diff = TIER_OF_LEVEL[self.level]
        self.prof = LEVELS[self.level]
        self.tick = random.random()
        self.first_attack = self.prof['first_attack']
        self.wave = self.prof['wave_min'][1]
        self.max_vils = self.prof['vils'][0]
        self.attacking = False
        self.rebalance_t = 20.0
        self.tower_done = False
        self.target = None          # игрок, на которого идёт (или пойдёт) атака
        self.age_need = 99
        self.threat = False
        self.base = None
        self.want = None            # доли жителей по ресурсам (plan_want), пересчёт раз в 3 с
        self.want_t = 0.0
        self.goal = {}              # цена технологии, на которую копим (research)
        self.blocked = {}           # цена зданий плана, на которые не хватило (construct), и когда это было
        self.blocked_t = -99.0
        self.save_t = None          # с какого времени копим на эпоху
        self.mtech_t = 0.0          # раньше этого времени новую военную технологию не начинаем
        self.bad_nodes = {}         # id(ресурса) → до какого времени не брать (недоступен — житель застрял)
        self.vtrack = {}            # id(жителя) → (x, y, груз, время) — поиск застрявших
        self.stuck_t = 5.0
        # на водных картах — морская часть ИИ (game/naval_ai.py)
        self.naval = None
        from . import maps
        if maps.is_water(getattr(w, 'map_type', 'land')):
            from .naval_ai import NavalAI
            self.naval = NavalAI(self)
        self.army = ArmyPlanner(self)       # состав армии, военные технологии, осада, монахи
        self.war = WarPlanner(self)         # волны атаки, цели, отступление, зачистка

    def update(self, dt):
        self.tick -= dt
        if self.tick > 0:
            return
        self.tick = 0.5
        w = self.w
        units = [u for u in w.units if u.owner == self.pid]
        vils = [u for u in units if u.kind == 'villager']
        army = [u for u in units if u.kind != 'villager' and not u.d.get('civil') and not u.naval]
        ships = [u for u in units if u.naval]
        blds = [b for b in w.buildings if b.owner == self.pid]
        tcs = [b for b in blds if b.kind == 'town_center' and b.complete]
        tc = tcs[0] if tcs else None
        if tc is None and vils and not any(b.kind == 'town_center' for b in blds):
            self.nomad_tc(vils)                 # кочевье (или центр потерян): сначала — новый центр
            blds = [b for b in w.buildings if b.owner == self.pid]
        base = tc or (blds[0] if blds else None)
        if base is None:
            for a in army:
                if a.state == 'idle':
                    a.cmd_attack(self.nearest_enemy_thing(a.x, a.y))
            return
        if self.target is None or not w.players[self.target].alive or not w.hostile(self.pid, self.target):
            self.target = self.pick_target(base)
        self.base = base
        count = Counter(b.kind for b in blds)
        done = Counter(b.kind for b in blds if b.complete)
        self.max_vils = self.prof['vils'][self.p.age]
        reserve = self.age_reserve(vils, done, tcs)
        self.economy(vils, tcs, blds, reserve, count)
        self.construct(vils, tc, blds, count, done, reserve)
        eco_ai.update(self, units, vils, blds, count, done, reserve, tc)
        self.train(vils, army, blds, reserve, tc)
        self.fight(army, vils)
        ai_defense.tick(self, vils, army, blds, tc, count)
        if self.naval is not None:
            self.naval.update(vils, ships, blds, reserve, tc)

    # ---- эпохи
    def age_reserve(self, vils, done, tcs):
        p, w = self.p, self.w
        if any(a in p.researching for a in AGE_TECHS) or p.age >= min(3, getattr(w, 'max_age', 3)):
            return {}
        name = AGE_TECHS[p.age]
        need_v = self.prof['age_vils'][p.age]
        self.age_need = need_v
        if len(vils) < need_v or w.time < self.prof['age_min'][p.age] - 60:
            return {}
        cost = p.cost_of('tech', name)
        if w.time < self.prof['age_min'][p.age]:
            return dict(cost)           # вот-вот можно — копим
        ok, _ = w.tech_state(p, name)
        host = min(tcs, key=lambda b: len(b.queue)) if tcs else None
        if ok and host is not None and p.afford(cost) and len(host.queue) <= 1:
            p.pay(cost)
            host.queue.append(('tech', name))
            p.researching.add(name)
            return {}
        return dict(cost)

    # ---- экономика: доли жителей по ресурсам
    def plan_want(self, nv, reserve, tcs, count):
        """Доли жителей по ресурсам из потребностей на ближайшие ~2 минуты."""
        p, prof, age = self.p, self.prof, self.p.age
        need = dict.fromkeys(RES, 0.0)
        H = 120.0
        if nv < self.max_vils:
            need['food'] += max(1, len(tcs)) * H / 25 * 50
        if reserve:
            for r, v in reserve.items():
                need[r] += 0.7 * v
        elif age < 3 and nv >= prof['age_vils'][age] - 6:
            for r, v in p.cost_of('tech', AGE_TECHS[age]).items():
                need[r] += 0.5 * v
        spend = prof['spend'][age]
        if spend and nv >= prof['army_vils'][age] - 4:
            for r, f in self.army.expected_cost().items():
                need[r] += spend * f
        # дерево: дома, стройка и фермы — когда природной еды у центра (овцы, олени, ягоды) не хватит
        need['wood'] += (170, 300, 400, 400)[age] + 30 * max(0, len(tcs) - 1)
        fv = int((0.55 if age == 0 else 0.45) * nv)
        farms_need = max(0, fv - count['farm'] - int(self.natural_food() / 250))
        need['wood'] += 60 * min(8, farms_need)
        # здания из плана, на которые сейчас не хватает (в т. ч. нужные для следующей эпохи)
        if self.w.time - self.blocked_t < 15:
            for r, v in self.blocked.items():
                need[r] += v
        for r, v in self.goal.items():
            need[r] += 0.6 * v
        want = {}
        for r in RES:
            want[r] = max(0.0, need[r] - p.res[r]) + 0.25 * need[r]
        # долгие цели: камень на замок (копим с Феодальной, когда экономика уже развёрнута), центры в Замках
        if age >= 1 and prof['castles'][2] and count['castle'] < prof['castles'][max(2, age)] and \
                (age >= 2 or (prof['stone_early'] and nv >= prof['age_vils'][1] - 2)):
            eta = 420.0 if age == 1 else 90.0
            want['stone'] += max(0.0, 650 - p.res['stone']) * H / eta
        if age >= 2 and count['town_center'] < 1 + prof['tc_extra'][0]:
            want['stone'] += max(0.0, 100 - p.res['stone'])
        if age == 0 and nv < 12:
            want['gold'] = want['stone'] = 0.0
        tot = sum(want.values()) or 1.0
        frac = {r: v / tot for r, v in want.items()}
        floor = {'food': 0.45 if age == 0 else 0.3, 'wood': 0.3 if nv >= 8 else 0.22,
                 'gold': 0.0, 'stone': 0.0}
        cap = {'food': 0.65 if age == 0 else 0.7, 'wood': 0.55, 'gold': 0.4, 'stone': 0.1 if age < 2 else 0.25}
        for _ in range(2):
            for r in RES:
                frac[r] = min(cap[r], max(floor[r], frac[r]))
            tot = sum(frac.values()) or 1.0
            frac = {r: v / tot for r, v in frac.items()}
        if self.naval is not None:
            self.naval.adjust_want(frac, nv)     # рыбацкие корабли кормят — больше жителей на дерево
        # чего с избытком на складе — туда меньше жителей
        for k in RES:
            extra = p.res[k] - reserve.get(k, 0)
            if extra > max(300.0, 1.5 * need[k]):
                frac[k] *= 0.5
            if extra > 800:
                frac[k] *= 0.4
            if p.res[k] - reserve.get(k, 0) > 1500:
                frac[k] *= 0.3
        tot = sum(frac.values()) or 1.0
        return {k: v / tot for k, v in frac.items()}

    def natural_food(self):
        """Сколько еды осталось у главного центра без ферм: овцы, туши, олени, кабаны, ягоды, рыба у берега."""
        w = self.w
        bx, by = self.base.center()
        R = 14 * TILE
        s = 0.0
        for a in w.animals:
            if a.alive and (a.owner in (-1, self.pid)) and abs(a.x - bx) < R and abs(a.y - by) < R:
                s += a.amount
        for n in w.nodes:
            if n.alive and n.kind in ('berries', 'shore_fish') and abs((n.tx + .5) * TILE - bx) < R and \
                    abs((n.ty + .5) * TILE - by) < R:
                s += n.amount
        return s

    def vil_task(self, v):
        if v.state == 'gather' and v.target is not None:
            return 'food' if isinstance(v.target, Building) else v.target.res
        if v.state == 'return':
            return v.carry_res
        return None

    def economy(self, vils, tcs, blds, reserve, count):
        p, w = self.p, self.w
        nq = sum(1 for tc in tcs for q in tc.queue if q[1] == 'villager')
        vcost = p.cost_of('unit', 'villager')
        # на эпоху копим, не останавливая жителей; стоп — только когда еды почти хватает (или в Тёмные века)
        vres = None
        if reserve and len(vils) >= self.age_need and \
                (p.age == 0 or p.res['food'] >= 0.65 * reserve.get('food', 0)):
            vres = reserve
        for tc in tcs:
            in_q = sum(1 for q in tc.queue if q[1] == 'villager')
            if len(vils) + nq < self.max_vils and in_q < 2 and len(tc.queue) < 2 \
                    and p.afford(vcost, vres):
                p.pay(vcost)
                tc.queue.append(('unit', 'villager'))
                nq += 1
        if not vils:
            return
        n = len(vils)
        if self.want is None or w.time >= self.want_t:
            self.want_t = w.time + 3.0
            self.want = self.plan_want(n, reserve, tcs, count)
        want = self.want
        cur = Counter()
        for v in vils:
            r = self.vil_task(v)
            if r:
                cur[r] += 1
        self.unstick(vils)
        for v in vils:
            if v.state != 'idle':
                continue
            order = sorted(RES, key=lambda k: -(want[k] * n - cur[k]))
            for r in order:
                if self.assign(v, r):
                    cur[r] += 1
                    break
        self.rebalance_t -= 0.5
        if self.rebalance_t <= 0:
            self.rebalance_t = 4.0
            for _ in range(max(1, n // 25)):
                over = max(RES, key=lambda k: cur[k] - want[k] * n)
                under = min(RES, key=lambda k: cur[k] - want[k] * n)
                if cur[over] - want[over] * n > 1.5 and want[under] * n - cur[under] > 1.5:
                    moved = False
                    for v in vils:
                        if self.vil_task(v) == over and v.carry < 3 and v.state == 'gather':
                            if self.assign(v, under):
                                cur[over] -= 1
                                cur[under] += 1
                                moved = True
                            break
                    if not moved:
                        break
                else:
                    break

    def unstick(self, vils):
        """Жители, застрявшие у недоступного ресурса (путь перекрыт) — к другому ресурсу."""
        w = self.w
        self.stuck_t -= 0.5
        if self.stuck_t > 0:
            return
        self.stuck_t = 5.0
        now = w.time
        seen = {}
        for v in vils:
            prev = self.vtrack.get(id(v))
            key = (v.x, v.y, v.carry)
            seen[id(v)] = (key, prev[1] if prev and prev[0] == key else now)
            if prev is None or prev[0] != key:
                continue
            if v.state == 'gather' and isinstance(v.target, (Node, Building)) and now - prev[1] >= 10:
                t = v.target
                self.bad_nodes[id(t)] = now + 240
                r = self.vil_task(v)
                v.stop()
                if r is None or not self.assign(v, r):
                    for r2 in RES:
                        if self.assign(v, r2):
                            break
                seen[id(v)] = (None, now)
        self.vtrack = seen
        if len(self.bad_nodes) > 200:
            self.bad_nodes = {k: t for k, t in self.bad_nodes.items() if t > now}

    def find_res(self, v, kind, x, y, radius):
        """World.find_resource, но без ресурсов, к которым жители не смогли пройти."""
        n = self.w.find_resource(v, kind, x, y, radius)
        if n is None or self.bad_nodes.get(id(n), 0) < self.w.time:
            return n
        w = self.w
        best, bd = None, radius * TILE
        for m in w.nodes:
            if m.kind != kind or not m.alive or self.bad_nodes.get(id(m), 0) >= w.time:
                continue
            d = math.hypot((m.tx + 0.5) * TILE - x, (m.ty + 0.5) * TILE - y)
            if d < bd and w.exposed(m):
                bd, best = d, m
        return best

    def assign(self, v, r):
        w = self.w
        bx, by = self.base.center()
        if r == 'food':
            # туши и свои овцы у центра, затем олени рядом
            for a in w.animals:
                if a.alive and a.dead and a.amount > 0 and math.hypot(a.x - bx, a.y - by) < 10 * TILE:
                    if sum(1 for o in w.units if o.target is a) < 5:
                        v.cmd_gather(a)
                        return True
            sheep = [a for a in w.animals if a.alive and not a.dead and a.kind == 'sheep' and a.owner == self.pid
                     and math.hypot(a.x - bx, a.y - by) < 6 * TILE]
            if sheep:
                v.cmd_gather(min(sheep, key=lambda a: math.hypot(a.x - v.x, a.y - v.y)))
                return True
            deer = [a for a in w.animals if a.alive and not a.dead and a.kind == 'deer'
                    and math.hypot(a.x - bx, a.y - by) < 11 * TILE]
            if deer and not any(o.target in deer for o in w.units if o.owner == self.pid):
                v.cmd_gather(min(deer, key=lambda a: math.hypot(a.x - v.x, a.y - v.y)))
                return True
            n = self.naval.shore_fish(v, bx, by) if self.naval is not None else None
            if n is not None:
                v.cmd_gather(n)
                return True
            n = self.find_res(v, 'berries', bx, by, 16)
            if n is not None and self.has_drop_near('food', *n.center(), 5):
                v.cmd_gather(n)
                return True
            f = w.find_resource(v, 'farm', v.x, v.y, 40)
            if f is not None and self.bad_nodes.get(id(f), 0) < w.time:
                v.cmd_gather(f)
                return True
            for b in w.buildings:
                if b.owner == self.pid and b.kind == 'farm' and not b.complete and b.alive:
                    if not any(o.target is b for o in w.units if o.owner == self.pid and o.state == 'build'):
                        v.cmd_build(b)
                        return True
            fcost = self.p.cost_of('bld', 'farm')
            if self.p.afford(fcost):
                spot = None
                # вокруг центров (свободные места), у мельниц, затем дальше от главного центра
                for c in [b for b in w.buildings if b.owner == self.pid and b.kind == 'town_center' and b.complete]:
                    cx, cy = c.center()
                    spot = self.find_spot('farm', int(cx // TILE), int(cy // TILE), 2, 7, margin=False)
                    if spot:
                        break
                for m in ([] if spot else [m for m in w.buildings if m.owner == self.pid and m.kind == 'mill'
                                            and m.complete]):
                    spot = self.find_spot('farm', m.tx + 1, m.ty + 1, 2, 5, margin=False)
                    if spot:
                        break
                spot = spot or self.find_spot('farm', int(bx // TILE), int(by // TILE), 8, 18, margin=False)
                if spot:
                    self.p.pay(fcost)
                    b = w.place_building('farm', self.pid, *spot)
                    v.cmd_build(b)
                    return True
            return False
        kind = {'wood': 'tree', 'gold': 'gold', 'stone': 'stone'}[r]
        drops = []
        for b in w.buildings:
            if b.owner == self.pid and b.complete and r in b.d.get('drop', ()):
                drops.append((v.dist_to(b) if b.kind != 'town_center' else 1e9, b))
        drops.sort(key=lambda t: t[0])
        pts = [b.center() for _, b in drops[:3]] + [(bx, by)]
        for (cx, cy) in pts:
            n = self.find_res(v, kind, cx, cy, 28)
            if n is not None:
                v.cmd_gather(n)
                return True
        return False

    # ---- стройка
    def find_spot(self, kind, cx, cy, rmin, rmax, margin=True):
        w = self.w
        s = BUILDINGS[kind]['size']
        for r in range(rmin, rmax + 1):
            cands = []
            for dy in range(-r, r + 1):
                for dx in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) == r:
                        cands.append((cx + dx - s // 2, cy + dy - s // 2))
            random.shuffle(cands)
            for tx, ty in cands:
                if not w.can_place(kind, tx, ty, self.pid, check_explored=False):
                    continue
                if margin and not self.margin_ok(tx, ty, s):
                    continue
                return tx, ty
        return None

    def margin_ok(self, tx, ty, s):
        w = self.w
        for y in range(ty - 1, ty + s + 1):
            for x in range(tx - 1, tx + s + 1):
                if tx <= x < tx + s and ty <= y < ty + s:
                    continue
                if not (0 <= x < w.W and 0 <= y < w.H):
                    return False
                o = w.occ[y][x]
                if w.terrain[y][x] != 0 or isinstance(o, Building) or w.floor[y][x] is not None:
                    return False
        return True

    def nearest_node(self, kind, x, y, maxd=30):
        # Ресурсы только исчезают (новые узлы — лишь при генерации карты, счётчик Node.serial),
        # поэтому ближайший остаётся ближайшим, пока жив: кэш по (вид, точка, радиус).
        key = (kind, x, y, maxd)
        cache = self.__dict__.setdefault('_nn_cache', {})
        hit = cache.get(key)
        if hit is not None and hit[1] == Node.serial and (hit[0] is None or hit[0].alive) and \
                (hit[0] is None or self.bad_nodes.get(id(hit[0]), 0) < self.w.time):
            return hit[0]
        best, bd = None, maxd * TILE
        for n in self.w.nodes:
            if n.kind == kind and n.alive and self.bad_nodes.get(id(n), 0) < self.w.time:
                d = math.hypot((n.tx + 0.5) * TILE - x, (n.ty + 0.5) * TILE - y)
                if d < bd:
                    bd, best = d, n
        if len(cache) > 64:
            cache.clear()
        cache[key] = (best, Node.serial)
        return best

    def has_drop_near(self, res, x, y, r):
        for b in self.w.buildings:
            if b.owner == self.pid and res in b.d.get('drop', ()) and b.dist_px(x, y) < r * TILE:
                return True
        return False

    def enemy_dir(self):
        """Единичный вектор от базы к цели (для замка, точки сбора)."""
        bx, by = self.base.center()
        if self.target is None:
            return 0.0, 0.0
        ex, ey = self.w.starts[self.target]
        dx, dy = ex * TILE - bx, ey * TILE - by
        d = math.hypot(dx, dy) or 1
        return dx / d, dy / d

    def construct(self, vils, tc, blds, count, done, reserve):
        p, prof = self.p, self.prof
        if not vils:
            return
        bx, by = self.base.center()
        btx, bty = int(bx // TILE), int(by // TILE)
        nv = len(vils)
        age = p.age
        building_now = [b for b in blds if not b.complete and b.kind not in ('farm',) and not b.d.get('wall')]
        # дома: запас населения по темпу производства (центры + занятые военные здания)
        houses_wip = sum(1 for b in building_now if b.kind == 'house')
        producers = sum(1 for b in blds if b.complete and b.queue and b.d.get('trains')) + \
            sum(1 for b in blds if b.kind == 'town_center' and b.complete)
        margin = 3 + 2 * producers + (2 if age >= 2 else 0)
        room = p.cap + 5 * houses_wip - p.pop
        if p.cap < 200 + p.pop_bonus and room <= margin and houses_wip < 1 + producers // 3:
            if p.afford(p.cost_of('bld', 'house')):
                spot = self.find_spot('house', btx, bty, 4, 13) or self.find_spot('house', btx, bty, 14, 22)
                if spot:
                    self.start_build('house', spot, vils, 1)
                    return
        # брошенные стройки — вернуть строителя
        for b in building_now:
            if not any(v.state == 'build' and v.target is b for v in vils):
                free = [v for v in vils if v.state in ('idle', 'gather') and self.vil_task(v) in (None, 'wood')]
                if free:
                    cx, cy = b.center()
                    min(free, key=lambda v: math.hypot(v.x - cx, v.y - cy)).cmd_build(b)
                    return
        if len([b for b in building_now if b.kind != 'house']) >= max(2, nv // 14):
            return
        plan = []
        castles_want = prof['castles'][age]
        if count['castle'] < castles_want:
            plan.append(('castle', True, None))           # замок — первым делом в эпоху замков
        # здания, без которых не перейти в следующую эпоху — как только жителей почти хватает
        if 1 <= age < 3 and nv >= prof['age_vils'][age] - 5:
            need, cnt = AGE_REQ[AGE_TECHS[age]]
            have = [k for k in need if count[k]]
            if len(have) < cnt:
                for k in ('blacksmith', 'archery_range', 'market', 'stable', 'siege_workshop', 'castle'):
                    if k in need and not count[k] and p.allows(k):
                        plan.append((k, True, None))
                        break
        tree = self.nearest_node('tree', bx, by)
        wood_vils = [v for v in vils if self.vil_task(v) == 'wood' and v.target is not None]
        far = [v for v in wood_vils if not self.has_drop_near('wood', *v.target.center(), 3)]
        if far and len(far) * 2 >= len(wood_vils) and count['lumber_camp'] < 2 + nv // 10:
            tree = far[0].target
            plan.append(('lumber_camp', nv >= 5, tree))
        elif tree and not self.has_drop_near('wood', *tree.center(), 3):
            plan.append(('lumber_camp', nv >= 5 and count['lumber_camp'] < 1 + nv // 10, tree))
        berries = self.nearest_node('berries', bx, by, 16)
        if berries and not self.has_drop_near('food', *berries.center(), 4):
            plan.append(('mill', nv >= 7 and count['mill'] < 2, berries))
        gold = self.nearest_node('gold', bx, by)
        if gold and not self.has_drop_near('gold', *gold.center(), 4):
            plan.append(('mining_camp', nv >= (13 if self.diff >= 2 else 11) or age >= 1, gold))
        else:
            gv = [v for v in vils if self.vil_task(v) == 'gold' and v.target is not None]
            gfar = [v for v in gv if not self.has_drop_near('gold', *v.target.center(), 4)]
            if gfar and len(gfar) * 2 >= len(gv) and count['mining_camp'] < 4:
                plan.append(('mining_camp', True, gfar[0].target))
        stone = self.nearest_node('stone', bx, by)
        if stone and not self.has_drop_near('stone', *stone.center(), 4):
            plan.append(('mining_camp', age >= 1 and (nv >= 18 or prof['stone_early']), stone))
        plan.append(('barracks', nv >= 12 and count['barracks'] < 1, None))
        if age >= 1:
            plan.append(('blacksmith', count['blacksmith'] < 1 and nv >= 18, None))
        if age >= 2:
            plan.append(('town_center', tc is None, None))
            plan.append(('siege_workshop', count['siege_workshop'] < prof['workshops'][age], None))
            if nv >= 30 and count['town_center'] < 1 + prof['tc_extra'][age - 2]:
                plan.append(('town_center', True, 'far'))
        plan += self.prod_plan(count, nv)
        if age >= 1:
            stone_ok = count['castle'] >= 1 or p.res['stone'] >= 800 or not prof['castles'][2]
            plan.append(('tower', self.diff >= 1 and not self.tower_done and nv >= 20 and stone_ok, None))
        if age >= 2:
            plan.append(('university', count['university'] < 1 and nv >= 30, None))
            plan.append(('monastery', count['monastery'] < 1 and nv >= 34 and self.diff >= 1, None))
        blocked = {}
        nblk = 0
        castle_cost = p.cost_of('bld', 'castle') if count['castle'] < castles_want else None
        for kind, cond, near in plan:
            if not cond:
                continue
            cost = p.cost_of('bld', kind)
            if not p.afford(cost, reserve if kind not in DROPS else None):
                if nblk < 2:
                    nblk += 1
                    blocked = cost_add(blocked, cost)
                    self.blocked, self.blocked_t = blocked, self.w.time
                continue
            if kind != 'castle' and cost.get('stone') and castle_cost and \
                    p.res['stone'] - cost['stone'] < castle_cost['stone']:
                continue            # камень копится на замок
            if near == 'far':
                spot = self.tc_spot(btx, bty)
            elif near is not None:
                spot = self.find_spot(kind, near.tx, near.ty, 1, 6, margin=False)
            elif kind == 'tower':
                spot = self.find_spot(kind, btx, bty, 5, 8)
            elif kind == 'castle':
                ex, ey = self.enemy_dir()
                spot = self.find_spot(kind, int(btx + ex * 14), int(bty + ey * 14), 0, 6) or \
                    self.find_spot(kind, btx, bty, 5, 16)
            else:
                spot = self.find_spot(kind, btx, bty, 5, 16)
            if spot is None and near is None:
                # у центра тесно (фермы, дома, частокол) — подальше; места нет совсем — не держим план
                spot = self.far_spot(kind, btx, bty)
            if spot:
                if kind == 'tower':
                    self.tower_done = True
                nb = 1 if near not in (None, 'far') else {'castle': 5, 'town_center': 4}.get(kind, 2)
                self.start_build(kind, spot, vils, nb)
                return

    def far_spot(self, kind, btx, bty):
        """Место подальше от центра (17–30 клеток); неудачные поиски не повторяем чаще раза в 20 с."""
        fs = self.__dict__.setdefault('_far_fail', {})
        if self.w.time < fs.get(kind, -99):
            return None
        spot = self.find_spot(kind, btx, bty, 17, 30)
        if spot is None:
            fs[kind] = self.w.time + 20
        return spot

    def prod_plan(self, count, nv):
        """Следующее производственное здание (казармы/стрельбище/конюшня) по весам армии."""
        p, prof = self.p, self.prof
        age = p.age
        total = prof['prod'][age]
        have = sum(count[k] for k in PROD)
        if age == 0 or have >= total or nv < prof['army_vils'][age] - 6:
            return []
        pref = self.army.prod_pref()
        opts = [k for k in PROD if BUILDINGS[k]['age'] <= age and p.allows(k)]
        if age >= 1:
            # в Феодальную — хотя бы по одному стрельбищу и конюшне (нужны для Эпохи замков)
            for k in ('archery_range', 'stable'):
                if k in opts and count[k] < 1:
                    return [(k, True, None)]
        best = max(opts, key=lambda k: pref.get(k, 0.1) / (1 + count[k]))
        return [(best, True, None)]

    def tc_spot(self, btx, bty):
        """Место для нового центра: у золота/леса подальше от главного центра."""
        w = self.w
        cands = []
        for n in w.nodes:
            if n.kind in ('gold', 'stone', 'tree') and n.alive:
                d = math.hypot(n.tx - btx, n.ty - bty)
                if 12 <= d <= 24 and not self.has_drop_near('gold' if n.kind != 'tree' else 'wood',
                                                            (n.tx + .5) * TILE, (n.ty + .5) * TILE, 6):
                    cands.append((d + (0 if n.kind == 'gold' else 4) + random.random() * 3, n))
        cands.sort(key=lambda t: t[0])
        for _, n in cands[:6]:
            spot = self.find_spot('town_center', n.tx, n.ty, 3, 6)
            if spot:
                return spot
        return self.find_spot('town_center', btx, bty, 12, 20)

    def nomad_tc(self, vils):
        """Нет центра (карта «Кочевье»): место у золота и ягод рядом с жителями, строят все."""
        w, p = self.w, self.p
        if not p.afford(p.cost_of('bld', 'town_center')):
            return
        if w.time < self.__dict__.get('_tc_try', -1):
            return
        self._tc_try = w.time + 5
        cx = sum(v.x for v in vils) / len(vils) / TILE
        cy = sum(v.y for v in vils) / len(vils) / TILE
        near = min(vils, key=lambda v: math.hypot(v.x / TILE - cx, v.y / TILE - cy))
        vx, vy = near.x / TILE, near.y / TILE
        best = None
        for n in w.nodes:
            if n.kind not in ('gold', 'berries') or not n.alive:
                continue
            d = math.hypot(n.tx - vx, n.ty - vy)
            if d > 26:
                continue
            # у золота и ягод сразу: чем больше рядом еды и золота, тем лучше
            if best is None or d < best[0]:
                best = (d, n)
        tx, ty = (best[1].tx, best[1].ty) if best else (int(vx), int(vy))
        spot = self.find_spot('town_center', tx, ty, 4, 9) or self.find_spot('town_center', int(vx), int(vy), 0, 14)
        if spot:
            self.start_build('town_center', spot, vils, len(vils))

    def start_build(self, kind, spot, vils, nb):
        w, p = self.w, self.p
        if not p.pay(p.cost_of('bld', kind)):
            return
        b = w.place_building(kind, self.pid, *spot)
        cx, cy = b.center()
        cands = sorted([v for v in vils if v.state != 'build'], key=lambda v: (v.state != 'idle',
                                            self.vil_task(v) not in ('wood', None),
                                            math.hypot(v.x - cx, v.y - cy)))
        for v in cands[:nb]:
            v.cmd_build(b)

    # ---- армия
    def train(self, vils, army, blds, reserve, tc):
        w, p = self.w, self.p
        econ_ok = len(vils) >= self.prof['army_vils'][p.age] or w.time > 2400 or self.threat
        # технологии — первыми; на первую нужную (не дороже SAVE_MAX) армия копит, а не тратит всё на юнитов
        goal = self.research(blds, reserve)
        self.goal = goal
        own = Counter(line_of(a.kind) for a in army)
        # пока жителей мало — армия не съедает еду на следующего жителя
        vres = {'food': 50} if len(vils) < self.max_vils and not self.threat else {}
        # запас на эпоху первые полторы минуты сдерживает армию лишь наполовину — войска нужны и во время
        # накопления; дальше — полностью, чтобы переход не откладывался бесконечно
        if not reserve:
            self.save_t = None
        elif self.save_t is None:
            self.save_t = w.time
        half = {k: v // 2 for k, v in reserve.items()} if reserve and w.time - self.save_t < 90 else reserve
        keep = cost_add(cost_add(half, vres), goal) if not self.threat else {}      # напали — все ресурсы на войска
        if len(army) < self.prof['min_army'][p.age]:
            # минимальное войско (давление, защита) важнее технологий; запас на эпоху — лишь наполовину
            keep = cost_add({k: v // 2 for k, v in reserve.items()}, vres)
        # камень копится на замок — армия его не трогает (у юнитов камня почти нет), но и дерево на замок не нужно
        if econ_ok:
            self.army.train(blds, keep, own)

    SAVE_MAX = 900      # на технологию дороже этого (сумма ресурсов) армия не копит

    def research(self, blds, reserve):
        """Изучить одну технологию, если хватает; иначе вернуть цену той, на которую стоит копить."""
        w, p = self.w, self.p
        # экономические основы, затем военные (кузница, улучшения линий — ai_army.ArmyPlanner.tech_order)
        eco = ['loom', 'wheelbarrow', 'double_bit', 'horse_collar', 'gold_mining']
        # военные технологии — не чаще раза в prof['tech_gap'] с (уникальные — без ограничения),
        # иначе они съедают всё и здания армии простаивают
        mil_ok = w.time >= self.mtech_t
        order = eco + [t for t in self.army.tech_order(blds) if mil_ok or TECHS[t].get('civ')]
        goal = {}
        for name in order:
            ok, _ = w.tech_state(p, name)
            if not ok:
                continue
            host = next((b for b in blds if b.complete and name in b.d.get('techs', []) and len(b.queue) < 2), None)
            if host is None:
                continue
            cost = p.cost_of('tech', name)
            # улучшения линий и уникальные технологии сразу усиливают армию — не ждут накопления на эпоху
            civ_t = bool(TECHS[name].get('civ'))
            need = cost if TECHS[name].get('upgrade') or civ_t else cost_add(cost, reserve)
            if p.afford(need) and (name != 'loom' or w.time > 120):
                p.pay(cost)
                host.queue.append(('tech', name))
                p.researching.add(name)
                if name not in eco and not civ_t:
                    self.mtech_t = w.time + self.prof['tech_gap'][p.age]
                return {}
            if not goal and (sum(cost.values()) <= self.SAVE_MAX or civ_t) and name != 'loom' and \
                    (name in eco or civ_t or p.age <= 1):
                goal = dict(cost)
        return goal

    def pick_target(self, base):
        """Цель атаки: враг, которого уже бьют союзные ИИ, иначе ближайший живой враждебный игрок."""
        w = self.w
        bx, by = base.center()
        cands = [p for p in w.players if w.hostile(self.pid, p.id)]
        alive = [p for p in cands if p.alive] or cands
        if not alive:
            return None
        for ai in getattr(w, 'ais', ()):
            if ai is not self and w.allied(self.pid, ai.pid) and ai.attacking and ai.target is not None \
                    and w.hostile(self.pid, ai.target) and w.players[ai.target].alive:
                return ai.target
        return min(alive, key=lambda p: math.hypot(w.starts[p.id][0] * TILE - bx,
                                                   w.starts[p.id][1] * TILE - by)).id

    def nearest_enemy_thing(self, x, y, buildings_only=False, owner=None):
        """Ближайший враждебный юнит/здание; owner — только этого игрока."""
        w = self.w
        hrow = w.hmat[self.pid]
        best, bd = None, 1e18
        if not buildings_only:
            for u in w.units:
                if hrow[u.owner] and (owner is None or u.owner == owner) and not u.naval:
                    d = (u.x - x) ** 2 + (u.y - y) ** 2
                    if d < bd:
                        bd, best = d, u
        for b in w.buildings:
            if hrow[b.owner] and (owner is None or b.owner == owner) and not b.d.get('wall'):
                cx, cy = b.center()
                d = (cx - x) ** 2 + (cy - y) ** 2
                if d < bd:
                    bd, best = d, b
        return best

    def herd(self, army):
        w = self.w
        bx, by = self.base.center()
        for a in w.animals:
            if a.kind == 'sheep' and a.owner == self.pid and not a.dead and a.state == 'idle':
                if math.hypot(a.x - bx, a.y - by) > 5 * TILE:
                    a.cmd_move(bx + random.uniform(-2, 2) * TILE, by + 3 * TILE + random.uniform(-1, 1) * TILE)
        # разведчик в начале обходит окрестности и собирает овец
        if w.time < 600:
            for s in army:
                if s.kind == 'scout' and s.state == 'idle':
                    ang = random.uniform(0, math.tau)
                    d = random.uniform(8, 20 if w.time < 300 else 30) * TILE
                    x = max(TILE, min((w.W - 2) * TILE, bx + math.cos(ang) * d))
                    y = max(TILE, min((w.H - 2) * TILE, by + math.sin(ang) * d))
                    s.cmd_move(x, y)

    def fight(self, army, vils):
        w = self.w
        self.herd(army)
        my_blds = [b for b in w.buildings if b.owner == self.pid and b.kind != 'farm' and not b.d.get('wall')]
        hrow = w.hmat[self.pid]
        # враги (не корабли — они забота флота и башен, naval_ai) ближе 7 клеток к любому своему зданию;
        # кандидаты — из сетки юнитов вокруг каждого здания, порядок — как в w.units
        R = 7 * TILE
        near = set()
        hmask = w.hostile_mask(hrow)
        for b in my_blds:
            x0, y0 = b.tx * TILE, b.ty * TILE
            for u in w.units_in_rect(x0 - R, y0 - R, x0 + b.w * TILE + R, y0 + b.h * TILE + R, hmask):
                if u not in near and hrow[u.owner] and not u.naval and b.dist_px(u.x, u.y) < R:
                    near.add(u)
        threats = [u for u in w.units if u in near] if near else []
        # одинокий разведчик у базы — не повод снимать армию с атаки
        self.threat = bool(threats) and not all(u.kind == 'scout' for u in threats)
        if not self.threat and self.war.state in ('march', 'engage'):
            threats = []
        army = [a for a in army if not (w.time < 600 and a.kind == 'scout' and not threats)]
        self.war.update(army, vils, threats)
