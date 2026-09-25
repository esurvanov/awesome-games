"""Интерфейс обороны (примесь к ui.Game): протяжка стен, ворота, гарнизон, набат, значки.

ui.py вызывает отсюда хуки одной строкой; логика — game/defense.py, графика стен — game/wallgfx.py.
"""
import pygame

from .data import TILE, HW, HH, BUILDINGS, RES, shade
from .world import Unit, Building
from . import defense, wallgfx, sprites3d


class DefenseUI:
    line_start = None       # клетка начала протяжки стены
    gate_horiz = True       # предпочтительная ориентация ворот (Tab — повернуть)
    _bbox = {}
    _ghost = {}

    # ---- спрайты
    def wall_sprite(self, kind, owner):
        """Спрайт стены/ворот по умолчанию (для bsprite: иконки, меню)."""
        return wallgfx.kind_sprite(kind, self.pcolor(owner), self.civ_of(owner))

    def bsprite_for(self, b):
        """(surface, ox, oy, bbox) для конкретного здания: стены — с учётом соседей, ворота — открыты ли."""
        if not b.d.get('wall'):
            look = getattr(b, '_look', None)
            if look is None:
                look = b._look = self.blook(b.kind, b.owner, b.tx, b.ty)
            return self.bsprite(b.kind, b.owner, None, *look)
        col = self.pcolor(b.owner)
        if b.d.get('gate'):
            spr, ox, oy = wallgfx.gate_sprite(b.kind, col, b.w >= b.h, defense.gate_open(self.world, b),
                                              self.civ_of(b.owner))
        else:
            spr, ox, oy = wallgfx.piece_sprite(b.kind, col, defense.wall_mask(self.world, b), self.civ_of(b.owner))
        bb = self._bbox.get(id(spr))
        if bb is None:
            bb = self._bbox[id(spr)] = spr.get_bounding_rect()
        return spr, ox, oy, bb

    def draw_wall_build(self, b, sx, sy, spr, ox, oy, bb):
        """Стена/ворота в стройке: фундамент 0 A.D. под каждой клеткой, растущий сегмент, леса поверх.
        False — нет пререндеренных спрайтов (рисует процедурный запасной вариант)."""
        civ = self.civ_of(b.owner)
        fn = sprites3d.wall_build(b.kind, civ, 'fndn')
        sc = sprites3d.wall_build(b.kind, civ, 'scaf')
        if fn is None or sc is None:
            return False
        scr = self.screen
        cells = [(b.tx + i, b.ty + j) for j in range(b.h) for i in range(b.w)]
        for (cx, cy) in cells:
            px, py = self.w2s(cx * TILE, cy * TILE)
            scr.blit(fn[0], (px - fn[1], py - fn[2]))
        h = spr.get_height()
        vis_h = int((h - bb.top) * (0.05 + 0.95 * b.progress))
        if vis_h > 0 and b.progress > 0.05:
            part = spr.subsurface((0, h - vis_h, spr.get_width(), vis_h))
            scr.blit(part, (sx - ox, sy - oy + h - vis_h))
        if b.progress > 0.12:
            s_img, sox, soy = sc
            sh = s_img.get_height()
            sv = int(sh * min(1.0, 0.35 + b.progress))
            sub = s_img.subsurface((0, sh - sv, s_img.get_width(), sv))
            for (cx, cy) in cells:
                px, py = self.w2s(cx * TILE, cy * TILE)
                scr.blit(sub, (px - sox, py - soy + sh - sv))
        self.drawn.append((pygame.Rect(sx - ox, sy - oy, *spr.get_size()), b, spr))
        pts = self.diamond(b.tx, b.ty, b.w, b.h)
        self.hpbar(sx - 30, pts[2][1] - 8, 60, b.progress, 0)
        return True

    def ghost_of(self, spr):
        g = self._ghost.get(id(spr))
        if g is None:
            g = self._ghost[id(spr)] = spr.copy()
            g.set_alpha(150)
        return g

    # ---- размещение
    def place_down(self, pos):
        """ЛКМ при размещении. True — обработано (стены: начало протяжки; ворота: заложить)."""
        kind = self.placing
        d = BUILDINGS[kind]
        if d.get('line'):
            self.line_start = self.place_tile(pos)
            return True
        if d.get('gate'):
            self.try_place_gate(pos)
            return True
        return False

    def place_up(self, pos):
        """Отпустили ЛКМ после протяжки — заложить линию стены."""
        start, self.line_start = self.line_start, None
        kind = self.placing
        if kind is None or start is None:
            return
        w = self.world
        end = self.place_tile(pos)
        vils = [u for u in self.selected if isinstance(u, Unit) and u.kind == 'villager' and u.owner == 0]
        placed = defense.place_wall_line(w, kind, 0, start[0], start[1], end[0], end[1], vils)
        if not placed and not defense.wall_plan(w, kind, 0, defense.line_tiles(*start, *end)):
            w.msg('Здесь строить нельзя', (255, 150, 90))
        p = w.players[0]
        if not (self.mods() & pygame.KMOD_SHIFT) or not p.afford(p.cost_of('bld', kind)):
            self.placing = None

    def gate_at(self, pos):
        kind = self.placing
        wx, wy = self.s2w(*pos)
        span = defense.gate_span(kind)
        res = None
        for horiz in (self.gate_horiz, not self.gate_horiz):
            if horiz:
                tx, ty = int(round(wx / TILE - span / 2)), int(wy // TILE)
            else:
                tx, ty = int(wx // TILE), int(round(wy / TILE - span / 2))
            if res is None:
                res = (tx, ty, horiz)
            x0, y0, gw, gh = defense.gate_rect(tx, ty, horiz, span)
            walls = sum(1 for y in range(y0, y0 + gh) for x in range(x0, x0 + gw)
                        if 0 <= x < self.world.W and 0 <= y < self.world.H
                        and defense.is_wall(self.world.occ[y][x]) and self.world.occ[y][x].owner == 0)
            if walls >= 2:
                return tx, ty, horiz
        return res

    def try_place_gate(self, pos):
        w = self.world
        p = w.players[0]
        kind = self.placing
        tx, ty, horiz = self.gate_at(pos)
        if not defense.can_place_gate(w, kind, tx, ty, horiz, 0):
            w.msg('Здесь строить нельзя', (255, 150, 90))
            return
        vils = [u for u in self.selected if isinstance(u, Unit) and u.kind == 'villager' and u.owner == 0]
        if defense.place_gate(w, kind, 0, tx, ty, horiz, vils) is None:
            w.msg('Не хватает ресурсов', (255, 150, 90))
            self.placing = None
            return
        if not (self.mods() & pygame.KMOD_SHIFT) or not p.afford(p.cost_of('bld', kind)):
            self.placing = None

    def defense_key(self, k):
        if k == pygame.K_TAB and self.placing and BUILDINGS[self.placing].get('gate'):
            self.gate_horiz = not self.gate_horiz
            return True
        if k == pygame.K_ESCAPE:
            self.line_start = None
        return False

    def draw_defense_ghost(self, mp):
        """Призрак протяжки стены / ворот. True — нарисовано здесь."""
        kind = self.placing
        d = BUILDINGS[kind]
        if not (d.get('line') or d.get('gate')):
            return False
        scr = self.screen
        w = self.world
        col = self.pcolor(0)
        if d.get('gate'):
            tx, ty, horiz = self.gate_at(mp)
            ok = defense.can_place_gate(w, kind, tx, ty, horiz, 0)
            x0, y0, gw, gh = defense.gate_rect(tx, ty, horiz, defense.gate_span(kind))
            self.tile_marks([(x, y, ok) for y in range(y0, y0 + gh) for x in range(x0, x0 + gw)])
            spr, ox, oy = wallgfx.gate_sprite(kind, col, horiz, False, self.civ_of(0))
            sx, sy = self.w2s(x0 * TILE, y0 * TILE)
            scr.blit(self.ghost_of(spr), (sx - ox, sy - oy))
            return True
        cur = self.place_tile(mp)
        tiles = defense.line_tiles(*(self.line_start or cur), *cur)
        tset = set(tiles)
        marks = []
        n = 0
        for (x, y) in tiles:
            ok = w.can_place(kind, x, y, 0)
            marks.append((x, y, ok))
            n += ok
        self.tile_marks(marks)
        for (x, y, ok) in sorted(marks, key=lambda m: m[0] + m[1]):
            if not ok:
                continue
            m = defense.mask_at(w, x, y, 0, tset)
            spr, ox, oy = wallgfx.piece_sprite(kind, col, m, self.civ_of(0))
            sx, sy = self.w2s(x * TILE, y * TILE)
            scr.blit(self.ghost_of(spr), (sx - ox, sy - oy))
        # цена линии у курсора
        p = w.players[0]
        cost = p.cost_of('bld', kind)
        cx, cy = mp[0] + 18, mp[1] + 14
        for r in RES:
            if cost.get(r):
                tot = cost[r] * n
                self.res_icon(r, cx + 7, cy)
                img = self.text(f'{tot}', (cx + 17, cy), 'b', (240, 235, 220) if p.res[r] >= tot else (255, 110, 90),
                                anchor='midleft')
                cx = img.right + 10
        return True

    def tile_marks(self, marks):
        ov = None
        for x, y, ok in marks:
            pts = self.diamond(x, y, 1, 1)
            minx = min(q[0] for q in pts)
            miny = min(q[1] for q in pts)
            if ov is None:
                ov = {}
            s = ov.get(ok)
            if s is None:
                s = ov[ok] = pygame.Surface((2 * HW + 2, 2 * HH + 2), pygame.SRCALPHA)
                pygame.draw.polygon(s, (60, 255, 60, 70) if ok else (255, 50, 50, 100),
                                    [(q[0] - minx, q[1] - miny) for q in pts])
            self.screen.blit(s, (minx, miny))

    # ---- кнопки
    def defense_buttons(self, b):
        w = self.world
        p = w.players[0]
        items = []
        if b.kind == 'town_center':
            if getattr(p, 'bell', False):
                items.append(dict(icon=('x', 'clear'), act=('clear',), ok=True,
                                  tip=['Всё чисто', {}, 'Жители — к прежним делам']))
            else:
                items.append(dict(icon=('x', 'bell'), act=('bell',), ok=True,
                                  tip=['Набат', {}, 'Жители — в укрытие']))
        if b.garrison:
            items.append(dict(icon=('x', 'eject'), act=('eject', b), ok=True,
                              tip=['Выпустить', {}, f'Внутри: {len(b.garrison)}']))
        return items

    def defense_press(self, act):
        w = self.world
        if act[0] == 'bell':
            defense.ring_bell(w, 0)
        elif act[0] == 'clear':
            defense.all_clear(w, 0)
        elif act[0] == 'eject':
            defense.eject(w, act[1])
        else:
            return False
        return True

    def draw_x_icon(self, ic, name, size):
        c = size // 2
        s = size / 40
        gold = (236, 196, 70)
        if name in ('bell', 'clear'):
            pts = [(c - 11 * s, c + 8 * s), (c - 8 * s, c + 3 * s), (c - 7 * s, c - 7 * s), (c, c - 12 * s),
                   (c + 7 * s, c - 7 * s), (c + 8 * s, c + 3 * s), (c + 11 * s, c + 8 * s)]
            pygame.draw.polygon(ic, gold, pts)
            pygame.draw.polygon(ic, shade(gold, -90), pts, 2)
            pygame.draw.circle(ic, shade(gold, -70), (c, int(c + 11 * s)), max(2, int(3 * s)))
            pygame.draw.line(ic, (255, 245, 200), (c - 3 * s, c - 6 * s), (c - 4 * s, c + 3 * s), 2)
            if name == 'clear':
                pygame.draw.lines(ic, (90, 230, 90), False, [(c + 2 * s, c + 8 * s), (c + 8 * s, c + 14 * s),
                                                              (c + 17 * s, c + 1 * s)], max(3, int(4 * s)))
            else:
                for k in (-1, 1):
                    pygame.draw.arc(ic, (255, 120, 90), (c + k * 14 * s - 4 * s, c - 10 * s, 8 * s, 16 * s),
                                    -1.2 if k > 0 else 1.9, 1.2 if k > 0 else 4.3, 2)
        elif name == 'eject':
            wall = (170, 164, 150)
            pygame.draw.rect(ic, wall, (c - 15 * s, c - 13 * s, 16 * s, 26 * s))
            pygame.draw.rect(ic, (70, 48, 30), (c - 11 * s, c - 5 * s, 9 * s, 18 * s))
            pygame.draw.polygon(ic, (120, 230, 120), [(c + 2 * s, c - 3 * s), (c + 10 * s, c - 3 * s),
                                                      (c + 10 * s, c - 9 * s), (c + 18 * s, c + 1 * s),
                                                      (c + 10 * s, c + 11 * s), (c + 10 * s, c + 5 * s),
                                                      (c + 2 * s, c + 5 * s)])
        elif name == 'shield':
            pts = [(c - 12 * s, c - 12 * s), (c + 12 * s, c - 12 * s), (c + 12 * s, c + 1 * s), (c, c + 14 * s),
                   (c - 12 * s, c + 1 * s)]
            pygame.draw.polygon(ic, (120, 150, 200), pts)
            pygame.draw.polygon(ic, (40, 50, 80), pts, 2)

    # ---- приказ «в гарнизон»
    def garrison_command(self, units, target, wx, wy):
        """ПКМ по своему зданию с гарнизоном. К центру жители идут внутрь только с Alt
        (без Alt — несут ресурсы, как в оригинале). True — приказ отдан."""
        w = self.world
        if not isinstance(target, Building) or target.owner != 0 or defense.capacity(target) <= 0:
            return False
        alt = self.mods() & pygame.KMOD_ALT
        vils = [u for u in units if u.kind == 'villager']
        if target.d.get('drop') and vils and not alt:
            return False
        allowed = target.d.get('garrison_cls', ('vil', 'inf', 'arch'))
        cands = [u for u in units if u.cls in allowed]
        if not cands:
            return False
        room = defense.capacity(target) - len(target.garrison)
        if room <= 0:
            w.msg('Нет места', (255, 150, 90))
            return True
        cands.sort(key=lambda u: u.dist_to(target))
        for u in cands[:room]:
            self.o(u, ('garrison', target))
        rest = [u for u in units if u not in cands[:room]]
        self.group_move(rest, wx, wy)
        self.markers.append((wx, wy, (120, 170, 255), w.time))
        w.emit('command', wx, wy, 0, 'garrison')
        return True

    # ---- гарнизон на экране и в панели
    def draw_garrison_badge(self, b, sx, top):
        n = len(b.garrison)
        x, y = int(sx), int(top) - 18
        pts = [(x - 9, y - 9), (x + 9, y - 9), (x + 9, y + 1), (x, y + 9), (x - 9, y + 1)]
        pygame.draw.polygon(self.screen, (40, 36, 30), [(px + 1, py + 1) for px, py in pts])
        pygame.draw.polygon(self.screen, self.pcolor(b.owner), pts)
        pygame.draw.polygon(self.screen, (240, 235, 220), pts, 1)
        self.text(str(n), (x, y - 1), 's', (255, 255, 255), anchor='center')

    def draw_garrison_info(self, b, x, y):
        cap = defense.capacity(b)
        if cap <= 0:
            return
        ic = self.icon('x', 'shield', 0, 26)
        self.screen.blit(ic, (x, y))
        self.text(f'{len(b.garrison)}/{cap}', (x + 30, y + 13), 'b', anchor='midleft')
        arrows = defense.bonus_arrows(b)
        if b.d.get('atk') and arrows:
            self.text(f'+{arrows}', (x + 84, y + 13), 'b', (255, 220, 130), anchor='midleft')
            self.stat(x + 108, y + 13, 'rng', '')
        for i, u in enumerate(b.garrison[:20]):
            r = pygame.Rect(x + (i % 10) * 30, y + 30 + (i // 10) * 32, 28, 28)
            pygame.draw.rect(self.screen, (70, 60, 48), r, border_radius=4)
            ic = self.icon('u', u.kind, u.owner, 26)
            self.screen.blit(ic, ic.get_rect(center=r.center))
            self.hpbar(r.x + 2, r.bottom - 3, 24, u.hp / u.max_hp, u.owner)
            if b.owner == 0:
                self.panel_hits.append((r, ('ungarrison', b, u)))
