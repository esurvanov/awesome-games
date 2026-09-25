"""Экран «Настройки» — 5 вкладок как в AoE2 DE: Игра · Графика · Интерфейс · Звук · Горячие клавиши.
Открывается из главного меню (⚙, профиль) и из меню F10 в партии (оверлей поверх игры).
Всё сохраняется в settings.json (game/settings.py; звук — через Audio, горячие клавиши — game/keymap.py).
"""
import pygame

from .data import SCREEN_W, SCREEN_H
from . import keymap, uiskin as S, widgets as W
from . import settings as gsettings

TABS = [('game', 'Игра', 'match-settings'), ('graphics', 'Графика', 'repair'),
        ('interface', 'Интерфейс', 'encyclopaedia'), ('audio', 'Звук', 'bell_level1'),
        ('keys', 'Горячие клавиши', 'production')]
BOX = pygame.Rect(SCREEN_W // 2 - 460, 70, 920, 640)

# (тип, ключ, подпись, параметры) — строки вкладок
ROWS = {
    'game': [('choice', 'game_speed', 'Скорость игры (новая партия)',
              [(1.0, 'Медленная'), (1.5, 'Спокойная'), (1.7, 'Нормальная'), (2.0, 'Быстрая')]),
             ('slider', 'scroll_speed', 'Скорость прокрутки', (0.5, 2.0)),
             ('toggle', 'edge_scroll', 'Прокрутка краем экрана', None),
             ('toggle', 'wheel_zoom', 'Масштаб колесом', None),
             ('choice', 'autosave', 'Автосохранение', [(0, 'Выкл.'), (5, 'Каждые 5 мин'), (10, 'Каждые 10 мин'),
                                                       (15, 'Каждые 15 мин')])],
    'graphics': [('toggle', 'fullscreen', 'Полный экран', None),
                 ('choice', 'fps_limit', 'Предел кадров', [(30, '30'), (60, '60'), (120, '120')]),
                 ('toggle', 'live_menu_bg', 'Живой фон меню (город)', None)],
    'interface': [('text', 'player_name', 'Имя игрока', None),
                  ('toggle', 'show_hotkeys', 'Буквы клавиш на кнопках', None),
                  ('toggle', 'show_score', 'Счёт игроков (F4)', None),
                  ('toggle', 'global_queue', 'Общая очередь производства', None),
                  ('choice', 'tooltip_scale', 'Размер подсказок', [(50, '50%'), (75, '75%'), (100, '100%')]),
                  ('toggle', 'cursor', 'Курсоры 0 A.D.', None)],
    'audio': [('toggle', 'music', 'Музыка', None), ('toggle', 'sfx', 'Звуки', None),
              ('slider', 'music_vol', 'Громкость музыки', (0.0, 1.0)),
              ('slider', 'sfx_vol', 'Громкость эффектов', (0.0, 1.0)),
              ('slider', 'voice_vol', 'Громкость голосов', (0.0, 1.0))],
}
AUDIO_KEYS = ('music', 'sfx', 'music_vol', 'sfx_vol', 'voice_vol')


class SettingsUI:
    set_tab = 'game'
    set_back = 'main'
    set_drop = None             # (якорь, ключ, значения, подписи, индекс)
    key_capture = None          # действие, ждущее нажатия клавиши
    text_edit = None            # ключ поля, которое редактируется
    set_drag = None             # ключ ползунка, который тянут

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

    # ---- значения
    def set_value(self, key):
        a = self.audio
        if key in AUDIO_KEYS:
            return (getattr(a, 'settings', None) or {}).get(key, 0.8 if key.endswith('vol') else True)
        if key == 'cursor':
            return bool(getattr(getattr(self, 'cursors', None), 'enabled', False))
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
        gsettings.put(key, v)
        if key == 'fullscreen':
            try:
                if bool(pygame.display.is_fullscreen()) != bool(v):
                    pygame.display.toggle_fullscreen()
            except Exception:
                pass
        if key == 'live_menu_bg':
            self.menu_bg = None

    # ---- разметка
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

    # ---- действия
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
                self.set_drop = (anchor, val, vals, [lb for _, lb in par], vals.index(cur) if cur in vals else None)
            elif typ == 'slider' and pos is not None:
                self.slide_to(val, pos[0])
                self.set_drag = val
            elif typ == 'text':
                self.text_edit = val

    def slide_to(self, key, x):
        typ, _, (lo, hi) = self.row_of(key)
        r = next(r for r, a, v in self.settings_rects() if a == 'ctl' and v == key)
        t = max(0.0, min(1.0, (x - r.x - 10) / max(1, r.w - 80)))
        self.put_value(key, round(lo + (hi - lo) * t, 2))

    def settings_event(self, e):
        """Событие для экрана настроек; True — обработано."""
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

    # ---- отрисовка
    def draw_settings_screen(self):
        """Экран настроек в меню (поверх фона меню)."""
        S.shade_overlay(self.screen, (0, 0, SCREEN_W, SCREEN_H), (10, 6, 2), 140)
        self.draw_settings_panel()

    def draw_settings_panel(self):
        scr = self.screen
        S.panel(scr, BOX, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), BOX, 2)
        W.plate(scr, (BOX.centerx, BOX.y + 30), 'Настройки', self.fonts['h'], 300)
        mp = pygame.mouse.get_pos()
        modal = self.set_drop is not None
        f, fb = self.fonts['m'], self.fonts['b']
        rects = self.settings_rects()
        for r, act, val in rects:
            h = r.collidepoint(mp) and not modal
            if act == 'tab':
                tid, lbl, ic = next(t for t in TABS if t[0] == val)
                W.tab(scr, r, lbl, fb, self.set_tab == val, h, ic)
            elif act == 'ctl':
                typ, lbl, par = self.row_of(val)
                S.text(scr, lbl, (BOX.x + 60, r.centery), self.fonts['l'], W.INK, anchor='midleft', shadow=None)
                v = self.set_value(val)
                if typ == 'toggle':
                    W.checkbox(scr, pygame.Rect(r.x, r.y, 200, r.h), bool(v), 'Вкл.' if v else 'Выкл.', fb, h)
                elif typ == 'choice':
                    lb = next((lb for vv, lb in par if vv == v), str(v))
                    W.field(scr, r.inflate(0, -6), lb, fb, h)
                elif typ == 'slider':
                    lo, hi = par
                    t = (float(v) - lo) / (hi - lo) if hi > lo else 0
                    W.slider(scr, pygame.Rect(r.x + 10, r.y, r.w - 80, r.h), max(0.0, min(1.0, t)), h)
                    txt = f'{int(round(float(v) * 100))}%' if hi <= 1.0 else f'×{float(v):.2f}'
                    S.text(scr, txt, (r.right - 8, r.centery), fb, W.INK, anchor='midright', shadow=None)
                elif typ == 'text':
                    edit = self.text_edit == val
                    s = str(v or '') + ('|' if edit and (pygame.time.get_ticks() // 400) % 2 else '')
                    W.field(scr, r.inflate(0, -6), s, fb, h or edit, arrow=False)
            elif act == 'key':
                i = [a for a, _, _, _ in keymap.ACTIONS].index(val)
                col = i // 9
                S.text(scr, keymap.LABEL[val], (BOX.x + 40 + col * 440, r.centery), f, W.INK, anchor='midleft',
                       shadow=None)
                cap = self.key_capture == val
                W.field(scr, r, 'нажмите…' if cap else keymap.pretty(keymap.name_for(val)), fb, h or cap,
                        arrow=False)
            elif act == 'keys_reset':
                W.red_button(scr, r, 'Клавиши по умолчанию', fb, 'hover' if h else 'normal')
            elif act == 'credits':
                W.red_button(scr, r, 'Об игре и авторы', fb, 'hover' if h else 'normal')
            elif act == 'done':
                W.red_button(scr, r, 'Готово', fb, 'hover' if h else 'normal')
        if self.set_tab == 'audio':
            S.text(scr, 'Голоса — отклики жителей и воинов', (BOX.x + 60, BOX.y + 130 + 5 * 56 + 6), f,
                   (110, 80, 50), anchor='midleft', shadow=None)
        if self.set_drop is not None:
            anchor, key, vals, lbls, idx = self.set_drop
            rs = W.list_rects(SCREEN_H, anchor, len(lbls))
            hi = next((i for r, i in rs if r.collidepoint(mp)), None)
            W.dropdown_list(scr, anchor, lbls, f, idx, hi)
