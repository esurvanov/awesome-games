"""Управление как в AoE2 DE (примесь к ui.Game): выбор (лимит 60, свои важнее, Ctrl/Shift, линии),
группы (Ctrl/Shift/Alt + цифра, здания в группах), поиск праздных, переходы к зданиям, прошлый вид,
удаление, режимы приказов (патруль, охрана, следование, атака с ходу, атака по земле), стойки, строй,
Shift-очередь, сигнал союзникам, кнопки армии в сетке команд.

Механика приказов — game/orders.py; отрисовка меток (номера групп, флажки маршрута, сигналы) —
game/controls_draw.py. ui.py вызывает отсюда хуки одной строкой.
"""
import pygame

from .data import BUILDINGS, TECHS, HOTKEYS
from .world import Unit, Building, Animal
from . import orders, defense

SEL_MAX = 60            # DE: не больше 60 в выборе
DBL_MS = 350
GROUP_MS = 400
FLARE_S = 4.0           # сколько секунд виден сигнал
# DE: «перейти к зданию» — Ctrl+буква (все такие — Ctrl+Shift+буква)
GOTO_KEYS = {
    pygame.K_b: ('barracks',), pygame.K_a: ('archery_range',), pygame.K_l: ('stable',),
    pygame.K_k: ('siege_workshop',), pygame.K_d: ('dock',), pygame.K_y: ('monastery',),
    pygame.K_c: ('castle',), pygame.K_m: ('market',), pygame.K_s: ('blacksmith',),
    pygame.K_u: ('university',), pygame.K_n: ('mill',), pygame.K_e: ('lumber_camp',),
    pygame.K_i: ('mining_camp',), pygame.K_t: ('tower', 'guard_tower', 'keep'),
}
# кнопки армии: слот сетки QWERT/ASDFG/ZXCVB → (действие, название, пояснение)
ORDER_SLOTS = [
    (0, 'patrol', 'Патруль', 'ЛКМ — точка, Shift — ещё точки'),
    (1, 'guard', 'Охранять', 'ЛКМ по своему юниту или зданию'),
    (2, 'follow', 'Следовать', 'ЛКМ по юниту'),
    (3, 'amove', 'Атака с ходу', 'Идти, атакуя всех по пути'),
    (4, 'aground', 'Атака по земле', 'Бить по точке'),
]
STANCE_SLOTS = [
    (5, 'aggressive', 'Агрессивная', 'Нападать и преследовать'),
    (6, 'defensive', 'Оборонительная', 'Преследовать недалеко и вернуться'),
    (7, 'stand_ground', 'Стоять на месте', 'Бить только в зоне атаки'),
    (8, 'no_attack', 'Не атаковать', 'Не отвечать на удары'),
]
FORM_SLOTS = [
    (10, 'line', 'Линия', 'Конница, пехота, стрелки, осада — рядами'),
    (11, 'box', 'Коробка', 'Ближний бой снаружи, стрелки внутри'),
    (12, 'staggered', 'Шахматный', 'Разреженно — против осады'),
    (13, 'flank', 'Фланг', 'Две половины с промежутком'),
]
STOP_SLOT = 9
SPARE_SLOTS = (14, 4, 13, 12, 11, 10)


def _line_roots():
    root = {}
    for t in TECHS.values():
        up = t.get('upgrade')
        if up:
            root[up[1]] = up[0]
    return root


class ControlsUI:
    order_mode = None       # 'patrol' | 'guard' | 'follow' | 'amove' | 'aground' | 'flare' — ждём ЛКМ
    order_pts = ()
    cam_prev = None
    _queue = False
    _line_root = None
    idle_mil_idx = 0
    tc_idx = 0
    last_event = None

    def ctl_init(self):
        self.order_mode = None
        self.order_pts = []
        self.cam_prev = None
        self.flares = []
        self.goto_idx = {}
        self.last_event = None
        self._queue = False

    # ============================================================ камера
    def jump_to(self, x, y):
        """Перенос камеры с запоминанием прошлого вида (Backspace)."""
        self.cam_prev = (self.cam_x, self.cam_y)
        self.center_on(x, y)

    def prev_view(self):
        if self.cam_prev is None:
            return
        cur = (self.cam_x, self.cam_y)
        self.cam_x, self.cam_y = self.cam_prev
        self.clamp_cam()
        self.cam_prev = cur

    def ctl_update(self):
        """Кадр интерфейса: последнее событие (Home), устаревшие сигналы."""
        w = self.world
        for ev in self.events:
            if ev[0] in ('attack_alert', 'build_done', 'train_done', 'tech_done', 'age_up', 'flare') and \
                    (ev[3] == 0 or ev[0] in ('attack_alert', 'flare')):
                if ev[0] != 'attack_alert' or ev[3] == 0:
                    self.last_event = (ev[1], ev[2])
        if self.flares:
            self.flares = [f for f in self.flares if w.time - f[2] < FLARE_S]

    # ============================================================ выбор
    def own_units(self, sel=None):
        return [u for u in (self.selected if sel is None else sel)
                if isinstance(u, Unit) and u.owner == 0 and u.alive]

    def cap(self, lst):
        return lst[:SEL_MAX]

    def line_of(self, kind):
        """Линия юнита (LineID): корень цепочки улучшений (ополченец → … → чемпион)."""
        if self._line_root is None:
            ControlsUI._line_root = _line_roots()
        root = self._line_root
        k = kind
        for _ in range(8):
            if k not in root:
                break
            k = root[k]
        return k

    def click_select(self, e, shift, ctrl, dbl):
        """Щелчок по карте: e — сущность под курсором (или None)."""
        w = self.world
        if e is None or getattr(e, 'is_relic', False):     # реликвию не выделяем — только ПКМ монахом
            if not (shift or ctrl):
                self.selected = []
            return
        own = e.owner == 0 and isinstance(e, (Unit, Building))
        if dbl and own:
            # двойной щелчок: вся линия на экране (здания — все того же вида), ≤ 60, ближние первыми
            if isinstance(e, Unit):
                ln = self.line_of(e.kind)
                pool = [u for u in w.units if u.owner == 0 and self.line_of(u.kind) == ln and self.on_screen(u)]
            else:
                pool = [b for b in w.buildings if b.owner == 0 and b.kind == e.kind and b.complete
                        and self.on_screen_b(b)]
            ex, ey = e.center()
            pool.sort(key=lambda o: (o is not e, abs(o.center()[0] - ex) + abs(o.center()[1] - ey)))
            self.selected = self.cap(pool)
            return
        if (shift or ctrl) and own and all(s.owner == 0 for s in self.selected) and \
                (isinstance(e, Unit) == all(isinstance(s, Unit) for s in self.selected) or not self.selected):
            if e in self.selected:
                self.selected.remove(e)
            elif len(self.selected) < SEL_MAX:
                self.selected.append(e)
            return
        self.selected = [e]

    def on_screen_b(self, b):
        sx, sy = self.w2s(*b.center())
        return self.in_view((sx, sy)) and 0 <= sx < self.screen.get_width()

    def box_select(self, r, shift):
        """Рамка: только свои юниты, сверху вниз, до 60 (здания — нет)."""
        w = self.world
        found = []
        for u in w.units:
            if u.owner != 0:
                continue
            sx, sy = self.w2s(u.x, u.y)
            if r.inflate(12, 12).collidepoint(sx, sy - 8):
                found.append((sy, sx, u))
        found.sort(key=lambda f: (f[0], f[1]))
        found = [f[2] for f in found]
        if not found:
            return None
        if shift:
            base = [s for s in self.selected if isinstance(s, Unit)]
            self.selected = self.cap(base + [u for u in found if u not in base])
        else:
            self.selected = self.cap(found)
        return found[0]

    def panel_select(self, e):
        """Щелчок по портрету в панели выбора: Ctrl — убрать, Shift — только этот вид, Ctrl+Shift — убрать вид."""
        m = self.mods()
        ctrl = m & (pygame.KMOD_CTRL | pygame.KMOD_META)
        shift = m & pygame.KMOD_SHIFT
        kind = e if isinstance(e, str) else e.kind
        if ctrl and shift:
            self.selected = [s for s in self.selected if s.kind != kind]
        elif ctrl:
            self.selected = [s for s in self.selected if s is not e]
        elif shift:
            self.selected = [s for s in self.selected if s.kind == kind]
        else:
            self.selected = [e] if not isinstance(e, str) else [s for s in self.selected if s.kind == kind][:1]

    # ============================================================ клавиши
    def ctl_key(self, k):
        """Клавиши управления. True — обработано."""
        w = self.world
        m = self.mods()
        ctrl = m & (pygame.KMOD_CTRL | pygame.KMOD_META)
        shift = m & pygame.KMOD_SHIFT
        alt = m & pygame.KMOD_ALT
        if k == pygame.K_ESCAPE and self.order_mode:
            self.order_mode = None
            self.order_pts = []
            return True
        if k == pygame.K_BACKSPACE:
            self.prev_view()
            return True
        if k == pygame.K_DELETE:
            self.delete_selected(all_of=bool(shift))
            return True
        if k == pygame.K_HOME:
            if self.last_event is not None:
                self.jump_to(*self.last_event)
            return True
        if k == pygame.K_h and not alt:
            tcs = [b for b in w.buildings if b.owner == 0 and b.kind == 'town_center']
            if tcs:
                if ctrl and shift:
                    self.selected = tcs
                    self.jump_to(*tcs[0].center())
                else:
                    self.tc_idx = (self.tc_idx + 1) % len(tcs) if len(self.selected) == 1 and \
                        self.selected[0] in tcs else 0
                    tc = tcs[self.tc_idx % len(tcs)]
                    self.selected = [tc]
                    self.jump_to(*tc.center())
            return True
        if k == pygame.K_PERIOD:
            if shift or ctrl:
                idle = self.idle_units(False)
                if idle:
                    self.selected = self.cap(idle)
                    self.jump_to(*idle[0].center())
            else:
                self.select_idle()
            return True
        if k == pygame.K_COMMA:
            if ctrl:
                units = self.idle_units(True)
            elif shift:
                units = [u for u in w.units if u.owner == 0 and self.is_military(u)]
            else:
                self.select_idle(military=True)
                return True
            if units:
                self.selected = self.cap(units)
                self.jump_to(*units[0].center())
            return True
        if pygame.K_0 <= k <= pygame.K_9:
            self.group_key(k - pygame.K_0 + (10 if alt else 0), ctrl, shift)
            return True
        if alt and k == pygame.K_f:
            self.order_mode = 'flare'
            return True
        if ctrl and k in GOTO_KEYS:
            self.goto_building(GOTO_KEYS[k], all_of=bool(shift))
            return True
        if k == pygame.K_F3:
            self.paused = not self.paused
            return True
        return False

    def is_military(self, u):
        d = u.d
        return u.cls != 'vil' and not d.get('fisher') and not d.get('command') and u.alive and u.inside is None

    def idle_units(self, military):
        w = self.world
        if military:
            return [u for u in w.units if u.owner == 0 and u.state == 'idle' and self.is_military(u)
                    and u.mission is None and not u.orders]
        return [u for u in w.units if u.owner == 0 and u.kind == 'villager' and u.state == 'idle']

    def select_idle(self, military=False):
        idle = self.idle_units(military)
        if not idle:
            return
        if military:
            self.idle_mil_idx = (self.idle_mil_idx + 1) % len(idle)
            u = idle[self.idle_mil_idx]
        else:
            self.idle_idx = (self.idle_idx + 1) % len(idle)
            u = idle[self.idle_idx]
        self.selected = [u]
        self.jump_to(u.x, u.y)

    def goto_building(self, kinds, all_of=False):
        w = self.world
        bs = [b for b in w.buildings if b.owner == 0 and b.kind in kinds and b.complete]
        if not bs:
            return
        if all_of:
            self.selected = self.cap(bs)
            self.jump_to(*bs[0].center())
            return
        i = (self.goto_idx.get(kinds, -1) + 1) % len(bs)
        self.goto_idx[kinds] = i
        self.selected = [bs[i]]
        self.jump_to(*bs[i].center())

    def group_key(self, n, ctrl, shift):
        """Ctrl+N — назначить (юниты и здания, ≤ 60; юнит — только в одной группе); N — выбрать
        (дважды — камера); Shift+N — добавить к выбору; Ctrl+Shift+N — выбрать и к ним; Alt — группы 10–19."""
        w = self.world
        if ctrl and not shift:
            mem = self.cap([s for s in self.selected if s.owner == 0 and s.alive])
            for g, lst in self.groups.items():
                if g != n:
                    self.groups[g] = [s for s in lst if s not in mem]
            self.groups[n] = mem
            w.msg(f'Группа {n}: {len(mem)}')
            return
        g = [s for s in self.groups.get(n, []) if s.alive]
        if not g:
            return
        if shift and not ctrl:
            self.selected = self.cap(self.selected + [s for s in g if s not in self.selected])
            return
        now = pygame.time.get_ticks()
        if (ctrl and shift) or (self.last_group[0] == n and now - self.last_group[1] < GROUP_MS):
            self.jump_to(*g[0].center())
        self.last_group = (n, now)
        self.selected = g

    def group_of(self, e):
        for n, lst in self.groups.items():
            if e in lst:
                return n
        return None

    def delete_selected(self, all_of=False):
        """Del — удалить один (первый в выборе), Shift+Del — всех выбранных; здания тоже."""
        w = self.world
        own = [s for s in self.selected if s.owner == 0 and s.alive]
        if not own:
            return
        for e in (own if all_of else own[:1]):
            if isinstance(e, Unit):
                e.hp = 0
                w.damage(e, e, 1)
            else:
                p = w.players[0]
                if not e.complete and e.progress <= 0.0:
                    p.refund(p.cost_of('bld', e.kind))      # фундамент без стройки — ресурсы назад
                if e.garrison:
                    defense.eject(w, e)
                e.hp = 0
                w.damage(e, e, 1)
            if e in self.selected:
                self.selected.remove(e)

    def ctl_wheel(self, e):
        """Ctrl+колесо при закладке ворот — повернуть (как в DE; Tab тоже работает). True — съедено."""
        if self.placing and BUILDINGS[self.placing].get('gate') and \
                self.mods() & (pygame.KMOD_CTRL | pygame.KMOD_META):
            self.gate_horiz = not self.gate_horiz
            return True
        return False

    # ============================================================ приказы
    def queue_mode(self):
        return bool(self.mods() & pygame.KMOD_SHIFT)

    def o(self, u, item):
        """Приказ юниту из интерфейса (Shift — в очередь)."""
        return orders.issue(u, self.world, item, queue=self._queue)

    def formation_of(self, units):
        cnt = {}
        for u in units:
            f = getattr(u, 'formation', 'line')
            cnt[f] = cnt.get(f, 0) + 1
        return max(cnt, key=cnt.get) if cnt else 'line'

    def form_move(self, units, wx, wy, kind='move'):
        """Групповое перемещение строем: места по строю, скорость — по самому медленному."""
        if not units:
            return
        units = [u for u in units if u.alive]
        if not units:
            return
        heading = None
        if self._queue:
            # из последней точки очереди — туда же смотрит строй
            last = [it for u in units for it in (u.orders or ()) if it[0] in ('move', 'amove')]
            if last:
                heading = (wx - last[-1][1], wy - last[-1][2])
        slots = orders.layout(units, wx, wy, self.formation_of(units), heading)
        fs = orders.group_speed(units) if len(units) > 1 else None
        land = [s for s in slots if not s[0].naval]
        for u, x, y in slots:
            if kind == 'amove':
                self.o(u, ('amove', x, y))
            else:
                self.o(u, ('move', x, y, fs if not u.naval and len(land) > 1 else None))

    def start_order(self, mode):
        units = self.own_units()
        if not units:
            return
        if mode == 'aground' and not any(orders.can_attack_ground(u) for u in units):
            return
        self.order_mode = mode
        self.order_pts = []

    def order_click(self, pos, target=None, mm=False):
        """ЛКМ в режиме приказа. pos — экранная точка; mm — по мини-карте."""
        w = self.world
        mode = self.order_mode
        if mm:
            wx, wy = self.mm_to_world(pos)
            target = None
        else:
            wx, wy = self.s2w(*pos)
            target = self.entity_at(pos) if target is None else target
        shift = self.queue_mode()
        if mode == 'flare':
            self.flare(wx, wy)
            self.order_mode = None
            return
        units = self.own_units()
        self.order_mode = None if not (mode == 'patrol' and shift) else mode
        if not units:
            return
        self._queue = shift and mode != 'patrol'
        try:
            col = (255, 80, 60)
            if mode == 'patrol':
                self.order_pts.append((wx, wy))
                if shift and len(self.order_pts) < orders.PATROL_MAX:
                    self.order_mode = 'patrol'
                    self.markers.append((wx, wy, (120, 200, 255), w.time))
                    return
                pts = list(self.order_pts)
                self.order_pts = []
                for u in units:
                    self.o(u, ('patrol', pts))
                col = (120, 200, 255)
            elif mode == 'amove':
                if target is not None and w.hostile(0, getattr(target, 'owner', -1)):
                    for u in units:
                        self.o(u, ('attack', target))
                else:
                    self.form_move(units, wx, wy, 'amove')
            elif mode in ('guard', 'follow'):
                if target is None or isinstance(target, Animal) or getattr(target, 'owner', -1) < 0:
                    return
                if mode == 'guard' and not w.allied(0, target.owner):
                    return
                for u in units:
                    if u is not target:
                        self.o(u, (mode, target))
                col = (120, 255, 120)
            elif mode == 'aground':
                for u in units:
                    if orders.can_attack_ground(u):
                        self.o(u, ('aground', wx, wy))
            self.markers.append((wx, wy, col, w.time))
            w.emit('command', wx, wy, 0, 'attack' if mode in ('amove', 'aground') else 'move')
        finally:
            self._queue = False

    def flare(self, wx, wy):
        """Сигнал союзникам: метка на карте и мини-карте + звук (событие 'flare')."""
        w = self.world
        self.flares.append((wx, wy, w.time, 0))
        w.emit('flare', wx, wy, 0, None)

    # ============================================================ кнопки армии
    def army_selection(self, units):
        return any(self.is_military(u) and u.d['atk'] > 0 for u in units) or \
            (units and all(u.cls == 'monk' for u in units))

    def army_buttons(self, units, extra):
        """Сетка DE для армии: Q патруль · W охрана · E следовать · R атака с ходу · T атака по земле /
        A S D F — стойки · G стоп / Z X C V — строи · B — особое (свёртка, высадка)."""
        slots = {}
        mil = [u for u in units if u.cls != 'vil']
        st = self.common(mil, 'stance', 'aggressive')
        for i, name, title, tip in ORDER_SLOTS:
            if name == 'aground' and not any(orders.can_attack_ground(u) for u in units):
                continue
            slots[i] = dict(icon=('ctl', name + ('*' if self.order_mode == name else '')), act=('omode', name),
                            ok=True, tip=[title, {}, tip])
        for i, name, title, tip in STANCE_SLOTS:
            slots[i] = dict(icon=('ctl', name + ('*' if st == name else '')), act=('stance', name), ok=True,
                            tip=[title, {}, tip])
        slots[STOP_SLOT] = dict(icon=('stop', None), act=('stop', None), ok=True, tip=['Стоп', {}, 'Остановить'])
        if len(units) > 1:
            fm = self.formation_of(units)
            for i, name, title, tip in FORM_SLOTS:
                slots[i] = dict(icon=('ctl', name + ('*' if fm == name else '')), act=('form', name), ok=True,
                                tip=[title, {}, tip])
        free = [s for s in SPARE_SLOTS if s not in slots]
        for it, s in zip(extra, free):
            slots[s] = it
        out = []
        for s in sorted(slots):
            out.append(dict(slots[s], rect=self.grid_rect(s), key=HOTKEYS[s]))     # hud.py: сетка DE
        return out

    @staticmethod
    def common(units, attr, default):
        vals = {getattr(u, attr, default) for u in units}
        return vals.pop() if len(vals) == 1 else None

    def army_press(self, act):
        """Кнопки армии. True — обработано."""
        units = self.own_units()
        k = act[0]
        if k == 'stop':
            for u in units:
                orders.clear(u)
                u.stop()
            return True
        if k == 'stance':
            orders.set_stance([u for u in units if u.cls != 'vil'], act[1])
            return True
        if k == 'form':
            for u in units:
                u.formation = act[1]
            return True
        if k == 'omode':
            self.start_order(act[1])
            return True
        if k == 'pack':
            for u in units:
                if u.d.get('pack'):
                    orders.clear(u)
                    u.stop()
                    u.start_pack(self.world, act[1])
            return True
        return False

    # ============================================================ ПКМ: ремонт
    def relic_command(self, units, target, wx, wy):
        """Монахи: ПКМ по реликвии — один идёт поднять; ПКМ по своему монастырю — несущие сдают реликвии.
        True — приказ отдан."""
        w = self.world
        monks = [u for u in units if u.d.get('monk')]
        if not monks:
            return False
        if getattr(target, 'is_relic', False):
            free = [u for u in monks if u.relic is None]
            if not free or not target.free:
                return False
            u = min(free, key=lambda m: abs(m.x - target.x) + abs(m.y - target.y))
            self.o(u, ('relic', target))
            self.group_move([m for m in units if m is not u], wx, wy)
            self.markers.append((wx, wy, (255, 230, 120), w.time))
            w.emit('command', wx, wy, 0, 'work')
            return True
        if isinstance(target, Building) and target.kind == 'monastery' and target.owner == 0 and target.complete:
            carry = [u for u in monks if u.relic is not None]
            if not carry:
                return False
            for u in carry:
                self.o(u, ('relic_in', target))
            self.group_move([m for m in units if m not in carry], wx, wy)
            self.markers.append((wx, wy, (255, 230, 120), w.time))
            w.emit('command', wx, wy, 0, 'work')
            return True
        return False

    def repair_command(self, units, target, wx, wy):
        """Жители → своё раненое здание / осада / корабль: ремонт; остальные — как обычно. True — отдан."""
        w = self.world
        vils = [u for u in units if u.kind == 'villager']
        if not vils or not orders.repairable(vils[0], target):
            return False
        for u in vils:
            self.o(u, ('repair', target))
        rest = [u for u in units if u.kind != 'villager']
        if rest and not (isinstance(target, Building) and self.garrison_command(rest, target, wx, wy)):
            self.group_move(rest, wx, wy)
        self.markers.append((wx, wy, (120, 255, 120), w.time))
        w.emit('command', wx, wy, 0, 'work')
        return True


def unit_top_px(g, u):
    """Высота фигурки над ногами (для значков над юнитом)."""
    from .ui import _uset
    us = _uset(u, g.civ_of(u.owner))
    if us is not None:
        return us.bh + 10
    return u.d.get('bar') or u.d.get('bar_h') or (36 if u.cls == 'cav' else 30)

