"""ИИ: состав армии (контр-юниты), военные технологии, осада и монахи.

Используется из ai.AI: self.army = ArmyPlanner(ai). Все цены — через Player.cost_of."""
import math
import random
from collections import Counter

from .data import TILE, UNITS, TECHS, CIVS, BUILDINGS
from .world import unit_tags

# военные технологии по эпохам; улучшения линий берутся, только если ИИ эти линии обучает
ARMY_TECHS = [
    # Феодальная
    'man_at_arms', 'forging', 'fletching', 'scale_armor', 'padded_archer_armor', 'scale_barding', 'bloodlines',
    # Эпоха замков
    'crossbowman', 'long_swordsman', 'pikeman', 'elite_skirmisher', 'light_cavalry', 'iron_casting',
    'bodkin_arrow', 'chain_mail', 'chain_barding', 'leather_archer_armor', 'husbandry', 'thumb_ring',
    'ballistics', 'squires', 'sanctity', 'fervor', 'supplies',
    # Имперская
    'chemistry', 'cavalier', 'arbalester', 'two_handed_swordsman', 'capped_ram', 'halberdier', 'blast_furnace',
    'bracer', 'plate_mail', 'plate_barding', 'ring_archer_armor', 'onager', 'champion', 'heavy_cavalry_archer',
    'siege_engineers', 'paladin', 'hussar', 'siege_ram', 'parthian_tactics', 'heavy_camel_rider',
    'illumination', 'heavy_scorpion', 'siege_onager', 'redemption', 'arson',
]
# технологии монастыря — только если монахов уже несколько
MONK_TECHS = {'sanctity', 'fervor', 'illumination', 'redemption', 'block_printing', 'atonement'}
# сколько держать осадных/монахов (по базовому виду линии)
CAPS = {'ram': 3, 'mangonel': 2, 'scorpion': 2, 'bombard_cannon': 2, 'trebuchet': 3, 'monk': 3}


def line_of(kind):
    return UNITS[kind].get('line', kind)


class ArmyPlanner:
    def __init__(self, ai):
        self.ai = ai
        self.mix = Counter()
        self.mix_t = -99.0
        self.order = None       # (базовый вид, с какого времени копим) — см. train()
        self.ec = None          # доли ресурсов в тратах на армию (expected_cost), кэш
        self.ec_t = -99.0

    # ---- разведка состава врага
    def enemy_mix(self):
        w = self.ai.w
        if w.time - self.mix_t < 5:
            return self.mix
        self.mix_t = w.time
        hrow = w.hmat[self.ai.pid]
        c = Counter()
        for u in w.units:
            if not hrow[u.owner] or u.cls == 'vil':
                continue
            tags = unit_tags(u.kind)
            c['all'] += 1
            if 'cav' in tags and 'arch' not in tags:
                c['cav'] += 1
            if 'arch' in tags and 'gunpowder' not in tags:
                c['arch'] += 1
            if 'inf' in tags:
                c['inf'] += 1
            if 'spear' in tags:
                c['spear'] += 1
            if 'skirm' in tags:
                c['skirm'] += 1
            if 'siege' in tags:
                c['siege'] += 1
            if 'monk' in tags:
                c['monk'] += 1
        self.mix = c
        return c

    def weights(self, own):
        """Веса выбора по базовому виду линии. own — Counter базовых линий своей армии."""
        p = self.ai.p
        age = p.age
        m = self.enemy_mix()
        n = max(4, m['all'])
        cav, arch, inf = m['cav'] / n, m['arch'] / n, m['inf'] / n
        spear, skirm = m['spear'] / n, m['skirm'] / n
        wts = {
            'militia': (3.0, 1.5, 1.5, 2.5)[age] + 2 * skirm,
            'spearman': 0.6 + 7 * cav,
            'archer': (3.0, 3.0, 2.6, 2.2)[age] * max(0.3, 1 - 2 * skirm),
            'skirmisher': 0.4 + 7 * arch,
            'cavalry_archer': (0, 0, 1.0, 1.6)[age] * max(0.3, 1 - 2 * skirm),
            'hand_cannoneer': 1.0 + 5 * inf,
            'scout': (2.0, 2.0, 0.6, 0.6)[age] + 3 * m['monk'] / n + 2 * arch,
            'knight': 4.0 * max(0.25, 1 - 2.5 * spear),
            'camel_rider': 0.4 + 6 * cav,
            'ram': 2.0,
            'mangonel': 0.6 + 5 * (inf + arch),
            'scorpion': 0.5 + 2 * inf,
            'bombard_cannon': 1.5,
            'trebuchet': 3.0,
            'monk': 1.5,
        }
        # цивилизация: свои сильные стороны (CIVS[civ]['ai'] — множители; уникальные юниты — там же)
        for k, m in CIVS.get(p.civ, {}).get('ai', {}).items():
            wts[k] = wts.get(k, 1.0) * m
        # уникальные юниты своей цивилизации — сильная сторона: в Замках и позже их в армии заметно больше
        for k in UNITS:
            if UNITS[k].get('civ') == p.civ and UNITS[k].get('line', k) == k:
                wts[k] = wts.get(k, 1.0) * (1.6 if age >= 2 else 1.0)
        caps = dict(CAPS)
        if age >= 3:
            # Имперская: против замков и башен врага — требушеты
            forts = self.enemy_forts()
            caps['trebuchet'] = 2 + min(4, forts) if self.ai.diff >= 1 else 2
            wts['trebuchet'] = wts.get('trebuchet', 1.0) * (1 + 0.5 * min(4, forts))
            caps['ram'] = 5 if self.ai.diff >= 2 else 3
        if age >= 2 and self.ai.diff >= 1 and own['ram'] < 2:
            wts['ram'] = wts.get('ram', 1.0) * 2.5        # без тарана волна Замков центр не возьмёт
        for k, cap in caps.items():
            if own[k] >= cap:
                wts[k] = 0
        return wts

    def enemy_forts(self):
        w = self.ai.w
        hrow = w.hmat[self.ai.pid]
        # замки, башни и центры — то, что требушеты ломают издалека
        return sum(1 for b in w.buildings if hrow[b.owner] and b.kind in ('castle', 'keep', 'guard_tower', 'tower',
                                                                          'bombard_tower', 'town_center'))

    def expected_cost(self):
        """Доли ресурсов в ожидаемых тратах на армию (по весам доступных линий) — для распределения жителей."""
        p, w = self.ai.p, self.ai.w
        if w.time - self.ec_t < 15 and self.ec:
            return self.ec
        self.ec_t = w.time
        wts = self.weights(Counter())
        tot = Counter()
        for k, wt in wts.items():
            if wt <= 0 or k not in UNITS or not p.allows(k):
                continue
            cur = p.current(k)
            if UNITS[cur]['age'] > max(1, p.age):
                continue
            for r, v in p.cost_of('unit', cur).items():
                tot[r] += wt * v
        s = sum(tot.values()) or 1.0
        self.ec = {r: v / s for r, v in tot.items()} or {'food': 0.5, 'gold': 0.5}
        return self.ec

    def prod_pref(self):
        """Предпочтение производственных зданий: сумма весов линий, которые в них обучаются."""
        p = self.ai.p
        wts = self.weights(Counter())
        out = {}
        for b in ('barracks', 'archery_range', 'stable'):
            s = 0.0
            for u in BUILDINGS[b].get('trains', ()):
                if p.allows(u, b) and UNITS[p.current(u)]['age'] <= max(1, p.age) and not UNITS[u].get('civil'):
                    s += wts.get(u, 1.0)
            out[b] = s
        return out

    def pick(self, b, opts, own):
        """Что обучить в здании b из opts (базовые виды). None — ничего."""
        p = self.ai.p
        w = self.ai.w
        wts = self.weights(own)
        opts = [o for o in opts if w.unit_state(p, p.current(o))[0] and wts.get(o, 1) > 0]
        if not opts:
            return None
        # на заказ копит train(); здесь — из того, на что хватает
        ok = [o for o in opts if p.afford(p.cost_of('unit', p.current(o)))] or opts
        return random.choices(ok, [wts.get(o, 1) for o in ok])[0]

    def train(self, blds, keep, own):
        """Обучение армии. Один «заказ» (вид по весам среди всех свободных зданий) копится до 30 с:
        остальные здания обучают, только если после них на заказ всё ещё хватит — так дорогие юниты
        (рыцари, требушеты) не вытесняются дешёвыми."""
        p, w = self.ai.p, self.ai.w
        if p.pop >= p.cap:
            return
        idle = []
        for b in blds:
            if b.complete and not b.queue:
                if b.d.get('water'):
                    continue    # доки — у морской части ИИ
                opts = [u for u in b.d.get('trains', []) if u != 'villager' and not UNITS[u].get('civil')
                        and p.allows(u, b.kind) and w.unit_state(p, p.current(u))[0]]
                if opts:
                    idle.append((b, opts))
        if not idle:
            return
        # замок без дела — уникальный юнит цивилизации (сильная сторона), если хватает, не трогая запасы
        for b, opts in list(idle):
            if b.kind != 'castle' or p.pop >= p.cap:
                continue
            uq = [u for u in opts if UNITS[u].get('civ') == p.civ]
            # в Имперскую против замков/башен сначала требушеты
            if p.age >= 3 and 'trebuchet' in opts and self.enemy_forts() and \
                    own['trebuchet'] < (2 + min(3, self.enemy_forts()) if self.ai.diff >= 1 else 1):
                uq = ['trebuchet']
            if uq and own[uq[0]] < 40:
                c = p.cost_of('unit', p.current(uq[0]))
                if p.afford(c, keep):
                    p.pay(c)
                    b.queue.append(('unit', p.current(uq[0])))
                    own[uq[0]] += 1
                    idle.remove((b, opts))
        if not idle:
            return
        wts = self.weights(own)
        if self.order is not None and (w.time - self.order[1] > 30 or
                                       not any(self.order[0] in o for _, o in idle)):
            self.order = None
        if self.order is None:
            cands = sorted({u for _, o in idle for u in o if wts.get(u, 1) > 0})
            if not cands:
                return
            self.order = (random.choices(cands, [wts.get(u, 1) for u in cands])[0], w.time)
        base = self.order[0]
        cost = p.cost_of('unit', p.current(base))
        host = next(b for b, o in idle if base in o)
        if p.afford(cost, keep):
            p.pay(cost)
            host.queue.append(('unit', p.current(base)))
            own[base] += 1
            self.order = None
            hold = keep
        else:
            hold = {k: keep.get(k, 0) + cost.get(k, 0) for k in set(keep) | set(cost)}
        for b, opts in idle:
            if b is host or b.queue or p.pop >= p.cap:
                continue
            ob = self.pick(b, opts, own)
            if ob is None:
                continue
            c = p.cost_of('unit', p.current(ob))
            if p.afford(c, hold):
                p.pay(c)
                b.queue.append(('unit', p.current(ob)))
                own[ob] += 1

    # ---- технологии
    def tech_order(self, blds):
        """Военные технологии, которые стоит изучать (в порядке важности)."""
        p = self.ai.p
        trains = set()
        for b in blds:
            if b.complete:
                trains.update(b.d.get('trains', ()))
        # линии, которые можно обучать; улучшения других линий не тратим
        lines = {line_of(p.current(k)) for k in trains} | {line_of(k) for k in trains}
        monks = sum(1 for u in self.ai.w.units if u.owner == self.ai.pid and u.d.get('monk'))
        out = []
        for t in ARMY_TECHS:
            d = TECHS.get(t)
            if d is None or d['age'] > p.age or (t in MONK_TECHS and monks < 2):
                continue
            up = d.get('upgrade')
            if up and line_of(up[0]) not in lines:
                continue
            out.append(t)
        # улучшения линий, добавленные другими модулями
        out += [t for t in TECHS if TECHS[t].get('upgrade') and t not in out and TECHS[t]['age'] <= p.age
                and line_of(TECHS[t]['upgrade'][0]) in lines]
        # уникальные технологии своей цивилизации (замок) — в числе первых: это сильные стороны цивилизации
        out = [t for t, d in TECHS.items() if d.get('civ') == p.civ and not d.get('upgrade') and d['age'] <= p.age
               and t not in out] + out
        # сначала — улучшения линий, которых в армии уже много
        own = Counter(line_of(u.kind) for u in self.ai.w.units if u.owner == self.ai.pid)
        rank = {t: i for i, t in enumerate(out)}

        def key(t):
            up = TECHS[t].get('upgrade')
            return (0 if up and own[line_of(up[0])] >= 4 else 1, rank[t])
        return sorted(out, key=key)

    # ---- бой: осада и монахи
    def siege_like(self, a):
        return bool(a.d.get('bld_only') or a.d.get('pack'))

    def lead_monks(self, army):
        """Монахи держатся у армии; с полной верой обращают ближайших врагов."""
        w = self.ai.w
        monks = [a for a in army if a.d.get('monk')]
        if not monks:
            return
        fighters = [a for a in army if not a.d.get('monk') and not self.siege_like(a)]
        if not fighters:
            return
        cx = sum(a.x for a in fighters) / len(fighters)
        cy = sum(a.y for a in fighters) / len(fighters)
        hrow = w.hmat[self.ai.pid]
        for m in monks:
            if m.state not in ('idle', 'move'):
                continue
            if w.time >= m.faith_t:
                best, bd = None, (12 * TILE) ** 2
                for u in w.units:
                    if hrow[u.owner] and (u.x - m.x) ** 2 + (u.y - m.y) ** 2 < bd and w.convertible(m, u):
                        bd, best = (u.x - m.x) ** 2 + (u.y - m.y) ** 2, u
                if best is not None:
                    m.cmd_attack(best)
                    continue
            if m.state == 'idle' and math.hypot(m.x - cx, m.y - cy) > 4 * TILE:
                m.cmd_move(cx + random.uniform(-30, 30), cy + random.uniform(-30, 30))
