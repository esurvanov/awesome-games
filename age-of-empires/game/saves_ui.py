"""The "Save Game" / "Load Game" window (the F10 menu in a match; "Single Player" -> "Load Game").
On the left - slots (a thumbnail, name, date, civilization, match time), on the right - a large thumbnail and data,
at the bottom - the save name (when saving), the buttons "Save"/"Load", "Delete", "Cancel".
Files - game/savegame.py.
"""
import pygame

from .data import SCREEN_W, SCREEN_H, TOP_H, VIEW_H
from . import i18n
from . import naval, savegame, uiskin as S, widgets as W

BOX = pygame.Rect(SCREEN_W // 2 - 470, 60, 940, 660)
LIST = pygame.Rect(BOX.x + 24, BOX.y + 70, 520, 480)
ROW = 68


def _clock(t):
    t = int(t)
    return f'{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}' if t >= 3600 else f'{t // 60:02d}:{t % 60:02d}'


def _civ_name(meta):
    """The name of a save's civilization in the player's language (by the 'civ' key; old files - as written)."""
    from . import civ_ui
    civ = meta.get('civ')
    return civ_ui.civ_name(civ) if civ else meta.get('civ_name', '')


class SavesUI:
    saves_mode = 'load'
    saves_list = ()
    saves_sel = None
    saves_scroll = 0
    save_name = ''
    saves_back = 'main'
    saves_msg = None
    _thumbs = None
    _shot = None

    def open_saves(self, mode, back='main'):
        self.saves_mode = mode
        self.saves_back = back
        self.saves_list = savegame.list_slots()
        self.saves_scroll = 0
        self.saves_msg = None
        self._thumbs = {}
        self.saves_sel = None if mode == 'save' else (self.saves_list[0][0] if self.saves_list else None)
        if mode == 'save' and self.world is not None:
            from .civ_ui import civ_name
            p = self.world.players[self.world.human]
            self.save_name = f'{civ_name(p.civ)} · {_clock(self.world.time)}'
            self._shot = self.game_snapshot()
        if self.state == 'menu':
            self.menu_screen = 'load'
        else:
            self.help = mode

    def close_saves(self):
        if self.state == 'menu':
            self.menu_screen = self.saves_back if self.saves_back in ('main', 'single') else 'main'
        else:
            self.help = 'menu'

    def game_snapshot(self):
        """A game frame without overlays (for the save thumbnail)."""
        keep = self.help
        try:
            self.help = False
            self.draw()
            return self.screen.subsurface((0, TOP_H, SCREEN_W, VIEW_H)).copy()
        except Exception:
            return None
        finally:
            self.help = keep

    def thumb(self, slot, path, size):
        key = (slot, size)
        img = self._thumbs.get(key) if self._thumbs is not None else None
        if img is None and path:
            try:
                img = pygame.transform.smoothscale(pygame.image.load(path), size)
            except Exception:
                img = None
            if self._thumbs is not None:
                self._thumbs[key] = img
        return img

    # ---- layout
    def saves_rects(self):
        items = []
        rows = ([(None, None, None)] if self.saves_mode == 'save' else []) + list(self.saves_list)
        for i, (slot, meta, th) in enumerate(rows):
            r = pygame.Rect(LIST.x + 4, LIST.y + 4 + i * ROW - self.saves_scroll, LIST.w - 8, ROW - 6)
            if r.bottom > LIST.y and r.y < LIST.bottom:
                items.append((r, 'slot', slot))
        y = BOX.bottom - 58
        if self.saves_mode == 'save':
            items.append((pygame.Rect(LIST.x, LIST.bottom + 16, LIST.w, 34), 'name', None))
        items.append((pygame.Rect(BOX.right - 690, y, 210, 42), 'do', None))
        items.append((pygame.Rect(BOX.right - 466, y, 210, 42), 'delete', None))
        items.append((pygame.Rect(BOX.right - 242, y, 210, 42), 'cancel', None))
        return items

    # ---- actions
    def saves_action(self, act, val):
        if act == 'slot':
            self.saves_sel = val
            if val is not None and self.saves_mode == 'save':
                meta = next((m for s, m, _ in self.saves_list if s == val), None)
                if meta:
                    self.save_name = meta.get('name', self.save_name)
        elif act == 'cancel':
            self.close_saves()
        elif act == 'delete':
            if self.saves_sel is not None:
                savegame.delete_slot(self.saves_sel)
                self.saves_list = savegame.list_slots()
                self.saves_sel = None if self.saves_mode == 'save' else (
                    self.saves_list[0][0] if self.saves_list else None)
        elif act == 'do':
            if self.saves_mode == 'save':
                self.do_save(self.saves_sel or savegame.new_slot_name(), self.save_name)
                self.saves_msg = i18n.t('saves.saved')
                self.help = False
            elif self.saves_sel is not None:
                self.do_load(self.saves_sel)

    def do_save(self, slot, name=None):
        w = self.world
        ui = self.ui_state()
        shot = self._shot if self._shot is not None else self.game_snapshot()
        self._shot = None
        path = savegame.save_world(w, slot, name, ui=ui, thumb=shot)
        w.msg(i18n.t('saves.game_saved', name=name or slot), (170, 230, 150))
        return path

    def ui_state(self):
        """What of the interface is saved together with the world: the camera, speed, groups (references to the world's units)."""
        return {'cam_x': self.cam_x, 'cam_y': self.cam_y, 'zoom': self.zoom, 'speed': self.speed,
                'groups': {k: list(v) for k, v in (getattr(self, 'groups', None) or {}).items()}}

    def restore_groups(self, groups):
        if isinstance(groups, dict):
            self.groups = {k: [u for u in v if getattr(u, 'alive', False) or getattr(u, 'inside', None)]
                           for k, v in groups.items()}

    def do_load(self, slot):
        try:
            w, ui, meta = savegame.load_world(slot)
        except Exception as ex:          # a broken/old file - report it, do not crash
            self.saves_msg = i18n.t('saves.load_failed', err=type(ex).__name__)
            return False
        self.attach_world(w, ui)
        self.help = False
        self.last_start = getattr(self, 'last_start', None)
        w.msg(i18n.t('saves.loaded', name=meta.get('name', slot)), (170, 230, 150))
        return True

    def saves_event(self, e):
        if e.type == pygame.KEYDOWN:
            if e.key == pygame.K_ESCAPE:
                self.close_saves()
                return True
            if self.saves_mode == 'save':
                if e.key in (pygame.K_RETURN, pygame.K_KP_ENTER):
                    self.saves_action('do', None)
                elif e.key == pygame.K_BACKSPACE:
                    self.save_name = self.save_name[:-1]
                elif e.unicode and e.unicode.isprintable() and len(self.save_name) < 40:
                    self.save_name += e.unicode
                return True
            if e.key in (pygame.K_RETURN, pygame.K_KP_ENTER):
                self.saves_action('do', None)
                return True
            return self.state != 'menu'
        if e.type == pygame.MOUSEWHEEL:
            n = len(self.saves_list) + (1 if self.saves_mode == 'save' else 0)
            self.saves_scroll = max(0, min(max(0, n * ROW - LIST.h + 8), self.saves_scroll - e.y * 40))
            return True
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            for r, act, val in self.saves_rects():
                if r.collidepoint(e.pos):
                    if act == 'slot' and not LIST.collidepoint(e.pos):
                        continue
                    self.audio.click()
                    self.saves_action(act, val)
                    return True
            return True
        return False

    # ---- drawing
    def draw_saves(self):
        scr = self.screen
        S.shade_overlay(scr, (0, 0, SCREEN_W, SCREEN_H), (10, 6, 2), 150)
        S.panel(scr, BOX, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), BOX, 2)
        W.plate(scr, (BOX.centerx, BOX.y + 30),
                i18n.t('saves.save_game') if self.saves_mode == 'save' else i18n.t('saves.load_game'),
                self.fonts['h'], 360)
        W.box(scr, LIST, 40)
        mp = pygame.mouse.get_pos()
        f, fb = self.fonts['m'], self.fonts['b']
        clip = scr.get_clip()
        rects = self.saves_rects()
        scr.set_clip(LIST.inflate(-4, -4))
        metas = {s: (m, th) for s, m, th in self.saves_list}
        for r, act, slot in rects:
            if act != 'slot':
                continue
            on = slot == self.saves_sel
            h = r.collidepoint(mp)
            pygame.draw.rect(scr, (250, 236, 200) if on else (232, 214, 174) if h else (220, 200, 158), r)
            pygame.draw.rect(scr, (190, 40, 26) if on else (140, 104, 60), r, 2 if on else 1)
            if slot is None:
                S.blit_icon(scr, 'construction', (r.x + 50, r.centery), 40)
                S.text_fit(scr, i18n.t('saves.new'), (r.x + 110, r.centery), self.fonts['l'], W.INK, anchor='midleft',
                           shadow=None, max_w=r.right - r.x - 120)
                continue
            meta, th = metas.get(slot, ({}, None))
            img = self.thumb(slot, th, (96, 60))
            if img is not None:
                scr.blit(img, (r.x + 4, r.y + 2))
            else:
                pygame.draw.rect(scr, (60, 50, 40), (r.x + 4, r.y + 2, 96, 60))
            S.text(scr, meta.get('name', slot), (r.x + 110, r.y + 16), fb, W.INK, anchor='midleft', shadow=None)
            S.text_fit(scr, f'{meta.get("date", "")}  ·  {_civ_name(meta)}  ·  {_clock(meta.get("time", 0))}',
                       (r.x + 110, r.y + 42), f, (100, 70, 40), anchor='midleft', shadow=None, max_w=r.right - r.x - 120)
        scr.set_clip(clip)
        if not self.saves_list and self.saves_mode == 'load':
            S.text_fit(scr, i18n.t('saves.empty'), LIST.center, self.fonts['l'], (110, 80, 50), anchor='center',
                       shadow=None, max_w=LIST.w - 20)
        # on the right - the selection
        right = pygame.Rect(LIST.right + 20, LIST.y, BOX.right - LIST.right - 44, LIST.h)
        W.box(scr, right, 40)
        sel = metas.get(self.saves_sel)
        if sel is not None or self.saves_mode == 'save':
            meta, th = sel if sel is not None else ({}, None)
            tsz = (right.w - 20, int((right.w - 20) * 0.625))
            img = self.thumb(self.saves_sel, th, tsz) if sel is not None else (
                pygame.transform.smoothscale(self._shot, tsz) if self._shot is not None else None)
            if img is not None:
                scr.blit(img, (right.x + 10, right.y + 10))
            y = right.y + tsz[1] + 30
            if sel is not None:
                rows = [('time', _clock(meta.get('time', 0))), ('diplomacy', _civ_name(meta)),
                        ('population', i18n.t('saves.players_n', n=meta.get('players', 0))),
                        ('portraits/technologies/cartography.png',
                         f'{naval.MAP_NAMES.get(meta.get("map"), "")} · {meta.get("size", "")}²'),
                        ('encyclopaedia', meta.get('date', ''))]
            else:
                w = self.world
                rows = [('time', _clock(w.time)), ('population', i18n.t('saves.players_n', n=len(w.players)))]
            for ic, txt in rows:
                S.blit_icon(scr, ic, (right.x + 26, y), 24)
                S.text_fit(scr, txt, (right.x + 48, y), fb, W.INK, anchor='midleft', shadow=None, max_w=right.w - 60)
                y += 32
        for r, act, _ in rects:
            h = r.collidepoint(mp)
            if act == 'name':
                caret = '|' if (pygame.time.get_ticks() // 400) % 2 else ''
                S.text(scr, i18n.t('saves.name'), (r.x - 4, r.y - 10), self.fonts['bs'], W.INK, shadow=None)
                W.field(scr, r, self.save_name + caret, fb, True, arrow=False)
            elif act == 'do':
                ok = self.saves_mode == 'save' or self.saves_sel is not None
                W.red_button(scr, r, i18n.t('gm.save') if self.saves_mode == 'save' else i18n.t('gm.load'), fb,
                             'disabled' if not ok else 'hover' if h else 'normal')
            elif act == 'delete':
                W.red_button(scr, r, i18n.t('common.delete'), fb,
                             'disabled' if self.saves_sel is None else 'hover' if h else 'normal')
            elif act == 'cancel':
                W.red_button(scr, r, i18n.t('common.cancel'), fb, 'hover' if h else 'normal')
        if self.saves_msg:
            S.text(scr, self.saves_msg, (BOX.centerx, BOX.bottom - 76), fb, (170, 30, 20), anchor='center',
                   shadow=None)
