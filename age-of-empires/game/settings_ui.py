"""The "Settings" screen - 5 tabs as in AoE2 DE: Game · Graphics · Interface · Sound · Hotkeys.
Opens from the main menu (gear, profile) and from the F10 menu in a match (an overlay over the game).
Everything is saved in settings.json (game/settings.py; sound - via Audio, hotkeys - game/keymap.py).
"""
import pygame

from .data import SCREEN_W, SCREEN_H
from . import i18n, keymap, uiskin as S, widgets as W
from . import settings as gsettings

TABS = [('game', 'settings.tab.game', 'match-settings'), ('graphics', 'settings.tab.graphics', 'repair'),
        ('interface', 'settings.tab.interface', 'encyclopaedia'), ('audio', 'settings.tab.audio', 'bell_level1'),
        ('keys', 'settings.tab.keys', 'production')]
BOX = pygame.Rect(SCREEN_W // 2 - 460, 70, 920, 640)

# (type, key, caption key in the locale, parameters) - the rows of the tabs; the value captions are locale keys too
# (except numbers and language names - those are given as they are)
ROWS = {
    'game': [('choice', 'language', 'settings.language', [(c, n) for c, n in i18n.available()]),
             ('choice', 'game_speed', 'settings.game_speed',
              [(1.0, 'match.val.speed.1.0'), (1.5, 'match.val.speed.1.5'), (1.7, 'match.val.speed.1.7'),
               (2.0, 'match.val.speed.2.0')]),
             ('slider', 'scroll_speed', 'settings.scroll_speed', (0.5, 2.0)),
             ('toggle', 'edge_scroll', 'settings.edge_scroll', None),
             ('toggle', 'wheel_zoom', 'settings.wheel_zoom', None),
             ('choice', 'autosave', 'settings.autosave', [(0, 'settings.off'), (5, 'settings.every_5'),
                                                          (10, 'settings.every_10'), (15, 'settings.every_15')])],
    'graphics': [('toggle', 'fullscreen', 'settings.fullscreen', None),
                 ('choice', 'fps_limit', 'settings.fps_limit', [(30, '30'), (60, '60'), (120, '120')]),
                 ('toggle', 'live_menu_bg', 'settings.live_menu_bg', None)],
    'interface': [('text', 'player_name', 'settings.player_name', None),
                  ('toggle', 'show_hotkeys', 'settings.show_hotkeys', None),
                  ('toggle', 'show_score', 'settings.show_score', None),
                  ('toggle', 'global_queue', 'settings.global_queue', None),
                  ('choice', 'tooltip_scale', 'settings.tooltip_scale', [(50, '50%'), (75, '75%'), (100, '100%')]),
                  ('toggle', 'cursor', 'settings.cursor', None),
                   ('toggle', 'cursor_soft', 'settings.cursor_soft', None)],
    'audio': [('toggle', 'music', 'settings.music', None), ('toggle', 'sfx', 'settings.sfx', None),
              ('slider', 'music_vol', 'settings.music_vol', (0.0, 1.0)),
              ('slider', 'sfx_vol', 'settings.sfx_vol', (0.0, 1.0)),
              ('slider', 'voice_vol', 'settings.voice_vol', (0.0, 1.0))],
}


def _lbl(s):
    """A value caption: a locale key -> text, the rest (numbers, language names) - as it is."""
    return i18n.t(s) if isinstance(s, str) and (s.startswith('settings.') or s.startswith('match.')) else str(s)
AUDIO_KEYS = ('music', 'sfx', 'music_vol', 'sfx_vol', 'voice_vol')


class SettingsUI:
    set_tab = 'game'
    set_back = 'main'
    set_drop = None             # (anchor, key, values, captions, index)
    key_capture = None          # an action waiting for a key press
    text_edit = None            # the key of the field being edited
    set_drag = None             # the key of the slider being dragged

    def open_settings(self, back='main', tab=None):
        self.set_back = back
        if tab:
            self.set_tab = tab
        self.set_drop = self.key_capture = self.text_edit = self.set_drag = None
        if self.state == 'menu':
            self.menu_screen = 'settings'
        else:
            self.help = 'settings'

    def close_settings(self):
        self.set_drop = self.key_capture = self.text_edit = self.set_drag = None
        if self.state == 'menu':
            self.menu_screen = self.set_back if self.set_back in ('main', 'single') else 'main'
        else:
            self.help = 'menu'

    # ---- values
    def set_value(self, key):
        a = self.audio
        if key in AUDIO_KEYS:
            return (getattr(a, 'settings', None) or {}).get(key, 0.8 if key.endswith('vol') else True)
        if key == 'cursor':
            return bool(getattr(getattr(self, 'cursors', None), 'enabled', False))
        if key == 'cursor_soft':
            return bool(getattr(getattr(self, 'cursors', None), 'soft', False))
        if key == 'language':
            return i18n.current()
        return gsettings.get(key)

    def put_value(self, key, v):
        a = self.audio
        if key in ('music', 'sfx'):
            if bool(self.set_value(key)) != bool(v):
                (a.toggle_music if key == 'music' else a.toggle_sfx)()
            return
        if key in AUDIO_KEYS:
            if hasattr(a, 'set_volume'):
                a.set_volume(key[:-4], v)
            else:
                a.settings[key] = v
            from . import sound
            sound.save_settings(a.settings)
            return
        if key == 'cursor':
            cur = getattr(self, 'cursors', None)
            if cur is not None:
                cur.enabled = bool(v)
                cur.cur = '?'
            gsettings.put('cursor', bool(v))
            return
        if key == 'cursor_soft':
            cur = getattr(self, 'cursors', None)
            if cur is not None:
                cur.set_soft(bool(v))
            gsettings.put('cursor_soft', bool(v))
        if key == 'language':
            if v != i18n.current():
                i18n.set_language(v)        # tables, fonts and caches - through subscribers (ui.Game.on_language)
            return
        gsettings.put(key, v)
        if key == 'fullscreen':
            try:
                if bool(pygame.display.is_fullscreen()) != bool(v):
                    pygame.display.toggle_fullscreen()
            except Exception:
                pass
        if key == 'live_menu_bg':
            self.menu_bg = None

    # ---- layout
    def settings_rects(self):
        items = []
        tw = (BOX.w - 40) // len(TABS)
        for i, (tid, _, _) in enumerate(TABS):
            items.append((pygame.Rect(BOX.x + 20 + i * tw, BOX.y + 64, tw - 6, 36), 'tab', tid))
        if self.set_tab == 'keys':
            for i, (act, _, _, _) in enumerate(keymap.ACTIONS):
                col, row = i // 9, i % 9
                items.append((pygame.Rect(BOX.x + 300 + col * 440, BOX.y + 124 + row * 44, 120, 32), 'key', act))
            items.append((pygame.Rect(BOX.x + 40, BOX.bottom - 60, 250, 40), 'keys_reset', None))
        else:
            for i, (typ, key, _, _) in enumerate(ROWS[self.set_tab]):
                items.append((pygame.Rect(BOX.x + 470, BOX.y + 130 + i * 56, 380, 34), 'ctl', key))
        if self.state == 'menu':
            items.append((pygame.Rect(BOX.centerx - 40, BOX.bottom - 60, 230, 40), 'credits', None))
        items.append((pygame.Rect(BOX.right - 260, BOX.bottom - 60, 220, 40), 'done', None))
        return items

    def row_of(self, key):
        for typ, k, lbl, par in ROWS.get(self.set_tab, ()):
            if k == key:
                return typ, lbl, par
        return None, '', None

    # ---- actions
    def settings_action(self, act, val, pos=None):
        if act == 'tab':
            self.set_tab = val
            self.set_drop = self.key_capture = self.text_edit = None
        elif act == 'done':
            self.close_settings()
        elif act == 'credits':
            self.menu_screen = 'credits'
            self.credits_scroll = 0
        elif act == 'keys_reset':
            keymap.reset()
        elif act == 'key':
            self.key_capture = val
        elif act == 'ctl':
            typ, _, par = self.row_of(val)
            if typ == 'toggle':
                self.put_value(val, not self.set_value(val))
            elif typ == 'choice':
                anchor = next(r for r, a, v in self.settings_rects() if a == 'ctl' and v == val)
                vals = [v for v, _ in par]
                cur = self.set_value(val)
                self.set_drop = (anchor, val, vals, [_lbl(lb) for _, lb in par], vals.index(cur) if cur in vals else None)
            elif typ == 'slider' and pos is not None:
                self.slide_to(val, pos[0])
                self.set_drag = val
            elif typ == 'text':
                self.text_edit = val

    def slide_to(self, key, x):
        typ, _, (lo, hi) = self.row_of(key)
        r = next(r for r, a, v in self.settings_rects() if a == 'ctl' and v == key)
        frac = max(0.0, min(1.0, (x - r.x - 10) / max(1, r.w - 80)))
        self.put_value(key, round(lo + (hi - lo) * frac, 2))

    def settings_event(self, e):
        """An event for the settings screen; True - handled."""
        if self.key_capture is not None and e.type == pygame.KEYDOWN:
            if e.key != pygame.K_ESCAPE:
                keymap.set_key(self.key_capture, e.key)
            self.key_capture = None
            return True
        if self.text_edit is not None and e.type == pygame.KEYDOWN:
            cur = str(gsettings.get(self.text_edit) or '')
            if e.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_ESCAPE):
                self.text_edit = None
            elif e.key == pygame.K_BACKSPACE:
                gsettings.put(self.text_edit, cur[:-1])
            elif e.unicode and e.unicode.isprintable() and len(cur) < 20:
                gsettings.put(self.text_edit, cur + e.unicode)
            return True
        if e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE:
            if self.set_drop is not None:
                self.set_drop = None
            else:
                self.close_settings()
            return True
        if e.type == pygame.MOUSEBUTTONUP and e.button == 1:
            self.set_drag = None
            return False
        if e.type == pygame.MOUSEMOTION and self.set_drag is not None:
            self.slide_to(self.set_drag, e.pos[0])
            return True
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            if self.set_drop is not None:
                anchor, key, vals, lbls, _ = self.set_drop
                self.set_drop = None
                for r, i in W.list_rects(SCREEN_H, anchor, len(lbls)):
                    if r.collidepoint(e.pos):
                        self.audio.click()
                        self.put_value(key, vals[i])
                return True
            self.text_edit = None
            for r, act, val in self.settings_rects():
                if r.collidepoint(e.pos):
                    self.audio.click()
                    self.settings_action(act, val, e.pos)
                    return True
            return self.state != 'menu'
        return False

    # ---- drawing
    def draw_settings_screen(self):
        """The settings screen in the menu (over the menu background)."""
        S.shade_overlay(self.screen, (0, 0, SCREEN_W, SCREEN_H), (10, 6, 2), 140)
        self.draw_settings_panel()

    def draw_settings_panel(self):
        scr = self.screen
        S.panel(scr, BOX, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), BOX, 2)
        W.plate(scr, (BOX.centerx, BOX.y + 30), i18n.t('menu.settings'), self.fonts['h'], 300)
        mp = pygame.mouse.get_pos()
        modal = self.set_drop is not None
        f, fb = self.fonts['m'], self.fonts['b']
        rects = self.settings_rects()
        for r, act, val in rects:
            h = r.collidepoint(mp) and not modal
            if act == 'tab':
                tid, lbl, ic = next(tb for tb in TABS if tb[0] == val)
                W.tab(scr, r, i18n.t(lbl), fb, self.set_tab == val, h, ic)
            elif act == 'ctl':
                typ, lbl, par = self.row_of(val)
                S.text_fit(scr, i18n.t(lbl), (BOX.x + 60, r.centery), self.fonts['l'], W.INK, anchor='midleft', shadow=None,
                           max_w=r.x - BOX.x - 70)
                v = self.set_value(val)
                if typ == 'toggle':
                    W.checkbox(scr, pygame.Rect(r.x, r.y, 200, r.h), bool(v), i18n.t('settings.on') if v else i18n.t('settings.off'),
                               fb, h)
                elif typ == 'choice':
                    lb = next((_lbl(lb) for vv, lb in par if vv == v), str(v))
                    W.field(scr, r.inflate(0, -6), lb, fb, h)
                elif typ == 'slider':
                    lo, hi = par
                    frac = (float(v) - lo) / (hi - lo) if hi > lo else 0
                    W.slider(scr, pygame.Rect(r.x + 10, r.y, r.w - 80, r.h), max(0.0, min(1.0, frac)), h)
                    txt = f'{int(round(float(v) * 100))}%' if hi <= 1.0 else f'×{float(v):.2f}'
                    S.text(scr, txt, (r.right - 8, r.centery), fb, W.INK, anchor='midright', shadow=None)
                elif typ == 'text':
                    edit = self.text_edit == val
                    s = str(v or '') + ('|' if edit and (pygame.time.get_ticks() // 400) % 2 else '')
                    W.field(scr, r.inflate(0, -6), s, fb, h or edit, arrow=False)
            elif act == 'key':
                i = [a for a, _, _, _ in keymap.ACTIONS].index(val)
                col = i // 9
                S.text_fit(scr, keymap.label(val), (BOX.x + 40 + col * 440, r.centery), f, W.INK, anchor='midleft',
                           shadow=None, max_w=250)
                cap = self.key_capture == val
                W.field(scr, r, i18n.t('settings.press_key') if cap else keymap.pretty(keymap.name_for(val)), fb, h or cap,
                        arrow=False)
            elif act == 'keys_reset':
                W.red_button(scr, r, i18n.t('settings.keys_reset'), fb, 'hover' if h else 'normal')
            elif act == 'credits':
                W.red_button(scr, r, i18n.t('menu.credits'), fb, 'hover' if h else 'normal')
            elif act == 'done':
                W.red_button(scr, r, i18n.t('common.done'), fb, 'hover' if h else 'normal')
        if self.set_tab == 'audio':
            S.text(scr, i18n.t('settings.voices_hint'), (BOX.x + 60, BOX.y + 130 + 5 * 56 + 6), f,
                   (110, 80, 50), anchor='midleft', shadow=None)
        if self.set_drop is not None:
            anchor, key, vals, lbls, idx = self.set_drop
            rs = W.list_rects(SCREEN_H, anchor, len(lbls))
            hi = next((i for r, i in rs if r.collidepoint(mp)), None)
            W.dropdown_list(scr, anchor, lbls, f, idx, hi)
