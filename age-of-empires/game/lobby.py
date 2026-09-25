"""Лобби схватки (примесь к ui.Game) — как «Standard Game» в AoE2 DE.

Слева — 8 строк игроков: номер-цвет (цвета в порядке DE), игрок (Вы / ИИ с уровнем 0–5 / Закрыто),
цивилизация (герб; окно выбора с описанием и «Подтвердить»), команда («–», 1–4, «?»); ниже — «Игроки: N»
и местность с превью карты. Справа — колонка «Параметры игры» (game/match.py: режим, размер карты, сложность
ИИ, ресурсы, население, скорость, открытие карты, начальная/конечная эпоха, перемирие, победа) и флажки
«Команды» / «Дополнительно», кнопки «Случайно» и «Сбросить». Внизу — «В главное меню» и «Начать игру».

Настройка лобби запоминается в settings.json ('lobby') при старте партии.
"""
import random

import pygame

from .data import SCREEN_W, SCREEN_H, PLAYER_COLORS, COLOR_NAMES
from . import civ_ui, maps, match, uiskin as S, widgets as W
from . import settings as gsettings

MAX_SLOTS = 8
DE_COLOR_NAMES = ['Синий', 'Красный', 'Зелёный', 'Жёлтый', 'Голубой', 'Фиолетовый', 'Серый', 'Оранжевый']
TEAM_LBL = ['–', '1', '2', '3', '4', '?']

SHEET = pygame.Rect(24, 12, SCREEN_W - 48, SCREEN_H - 24)
PLAYERS = pygame.Rect(56, 100, 724, 432)
MAPBOX = pygame.Rect(56, 544, 724, 170)
SETBOX = pygame.Rect(796, 100, 428, 614)
ROW_Y0 = PLAYERS.y + 46
ROW_H = 40
SET_Y0 = SETBOX.y + 46
SET_H = 29


def de_colors():
    """Номера PLAYER_COLORS в порядке DE: синий, красный, зелёный, жёлтый, голубой, фиолетовый, серый, оранжевый."""
    out = [COLOR_NAMES.index(n) for n in DE_COLOR_NAMES if n in COLOR_NAMES]
    out += [i for i in range(len(PLAYER_COLORS)) if i not in out]
    return out


def default_slots():
    order = de_colors()
    slots = []
    for i in range(MAX_SLOTS):
        slots.append({'kind': 'human' if i == 0 else 'ai' if i == 1 else 'closed', 'civ': 'random',
                      'color': order[i % len(order)], 'team': 0, 'level': 2})
    return slots


class LobbyUI:
    dropdown = None         # открытый список: (якорь, ключ, значения, подписи, текущий индекс)
    picker = None           # номер слота, для которого открыт выбор цивилизации
    picker_sel = None       # выделенная в окне выбора цивилизация (до «Подтвердить»)

    # ============================================================ модель
    def cfg_defaults(self):
        cfg = self.menu_cfg
        if 'slots' not in cfg:
            saved = gsettings.get('lobby')
            if isinstance(saved, dict) and len(saved.get('slots', ())) == MAX_SLOTS:
                cfg['slots'] = [dict(s) for s in saved['slots']]
                cfg['opts'] = match.normalize(saved.get('opts'))
            else:
                cfg['slots'] = default_slots()
                cfg['opts'] = match.defaults()
                cfg['opts']['speed'] = gsettings.get('game_speed', 1.7)
        cfg.setdefault('opts', match.defaults())
        if cfg['opts'].get('map') not in maps.LOBBY:     # старые сохранённые «материк/прибрежье»
            cfg['opts']['map'] = maps.DEFAULT
        return cfg

    def slots(self):
        return self.cfg_defaults()['slots']

    def opts(self):
        return self.cfg_defaults()['opts']

    def active_slots(self):
        return [i for i, s in enumerate(self.slots()) if s['kind'] != 'closed']

    def slot_civ(self, i):
        return self.slots()[i]['civ']

    def set_slot_civ(self, i, key):
        self.slots()[i]['civ'] = key

    def teams_ok(self):
        return match.teams_valid([self.slots()[i]['team'] for i in self.active_slots()])

    def ai_level_all(self):
        lv = {self.slots()[i]['level'] for i in self.active_slots() if self.slots()[i]['kind'] == 'ai'}
        return lv.pop() if len(lv) == 1 else None

    def set_players(self, n):
        n = max(2, min(MAX_SLOTS, n))
        for i, s in enumerate(self.slots()):
            if i == 0:
                continue
            if i < n and s['kind'] == 'closed':
                s['kind'] = 'ai'
                s['level'] = self.ai_level_all() if self.ai_level_all() is not None else 2
            elif i >= n:
                s['kind'] = 'closed'
        self.fix_colors()

    def fix_colors(self):
        """Цвета без повторов среди открытых слотов."""
        used = set()
        order = de_colors()
        for i in self.active_slots():
            s = self.slots()[i]
            if s['color'] in used:
                s['color'] = next(c for c in order if c not in used)
            used.add(s['color'])

    # ============================================================ разметка
    def setup_rects(self):
        """[(rect, действие, значение)] лобби."""
        items = []
        for i, s in enumerate(self.slots()):
            y = ROW_Y0 + i * ROW_H
            if s['kind'] != 'closed':
                items.append((pygame.Rect(PLAYERS.x + 16, y + 4, 30, 30), 'color', i))
            if i > 0:
                items.append((pygame.Rect(PLAYERS.x + 56, y + 5, 262, 28), 'player', i))
            if s['kind'] != 'closed':
                items.append((pygame.Rect(PLAYERS.x + 330, y + 3, 262, 32), 'slot_civ', i))
                items.append((pygame.Rect(PLAYERS.x + 604, y + 5, 44, 28), 'team', i))
        items.append((pygame.Rect(PLAYERS.x + 150, ROW_Y0 + MAX_SLOTS * ROW_H + 6, 110, 28), 'nplayers', None))
        # местность — плитки карт со значками (game/map_icons.py)
        for j, mt in enumerate(maps.LOBBY):
            items.append((pygame.Rect(MAPBOX.x + 12 + j * 118, MAPBOX.y + 30, 112, 134), 'map', mt))
        # колонка параметров
        for key, y in self.setting_rows():
            items.append((pygame.Rect(SETBOX.x + 200, y + 2, 212, 25), 'opt', key))
        fy = self.flags_y()
        for j, (key, lbl, _) in enumerate(match.FLAGS):
            col, row = j // 2, j % 2
            items.append((pygame.Rect(SETBOX.x + 18 + col * 206, fy + 26 + row * 26, 196, 24), 'flag', key))
        items.append((pygame.Rect(SETBOX.x + 16, SETBOX.bottom - 48, 190, 34), 'randomize', None))
        items.append((pygame.Rect(SETBOX.right - 206, SETBOX.bottom - 48, 190, 34), 'reset', None))
        items.append((pygame.Rect(56, SCREEN_H - 70, 250, 42), 'back', None))
        items.append((pygame.Rect(530, SCREEN_H - 70, 250, 42), 'play', None))
        return items

    def setting_rows(self):
        """[(ключ, y)] видимых строк колонки параметров: сначала местность, затем match.OPTIONS."""
        o = self.opts()
        keys = ['map'] + [k for k, _, _, _ in match.OPTIONS if match.visible(o, k)]
        return [(k, SET_Y0 + i * SET_H) for i, k in enumerate(keys)]

    def flags_y(self):
        return SET_Y0 + len(self.setting_rows()) * SET_H + 6

    def option_values(self, key):
        """(значения, подписи, текущий индекс) для списка."""
        o = self.opts()
        if key == 'map':
            vals = list(maps.LOBBY)
            lbls = [maps.name(m) for m in vals]
            cur = o.get('map', maps.DEFAULT)
        elif key == 'ai_all':
            vals = list(range(len(match.AI_LEVELS)))
            lbls = list(match.AI_LEVELS)
            cur = self.ai_level_all()
        elif key == 'player':
            vals = [('ai', lv) for lv in range(len(match.AI_LEVELS))] + [('closed', None)]
            lbls = [f'ИИ · {n}' for n in match.AI_LEVELS] + ['Закрыто']
            cur = None
        elif key == 'nplayers':
            vals = list(range(2, MAX_SLOTS + 1))
            lbls = [str(v) for v in vals]
            cur = len(self.active_slots())
        else:
            vals = [v for v, _ in match.OPT[key][1]]
            lbls = [lb for _, lb in match.OPT[key][1]]
            cur = o.get(key)
        idx = vals.index(cur) if cur in vals else None
        return vals, lbls, idx

    def picker_rects(self):
        keys = ['random'] + civ_ui.playable()
        box = pygame.Rect(90, 60, SCREEN_W - 180, SCREEN_H - 120)
        cw, ch = 112, 104
        items = []
        for i, k in enumerate(keys):
            items.append((pygame.Rect(box.x + 28 + (i % 5) * (cw + 6), box.y + 70 + (i // 5) * (ch + 8), cw, ch),
                          'pick', k))
        items.append((pygame.Rect(box.right - 440, box.bottom - 58, 200, 40), 'pick_ok', None))
        items.append((pygame.Rect(box.right - 226, box.bottom - 58, 200, 40), 'pick_cancel', None))
        return box, items

    # ============================================================ действия
    def lobby_action(self, act, val):
        o = self.opts()
        sl = self.slots()
        if act == 'color':
            used = {sl[j]['color'] for j in self.active_slots() if j != val}
            order = de_colors()
            c = sl[val]['color']
            i = order.index(c) if c in order else 0
            for _ in range(len(order)):
                i = (i + 1) % len(order)
                if order[i] not in used:
                    break
            sl[val]['color'] = order[i]
        elif act == 'team':
            sl[val]['team'] = (sl[val]['team'] + 1) % len(TEAM_LBL)
        elif act in ('player', 'opt', 'nplayers'):
            key = act if act != 'opt' else val
            vals, lbls, idx = self.option_values(key)
            anchor = next(r for r, a, v in self.setup_rects() if a == act and v == val)
            self.dropdown = (anchor, key, val, vals, lbls, idx)
        elif act == 'choose':
            self.apply_choice(*val)
        elif act == 'flag':
            o[val] = not o.get(val)
        elif act == 'map':
            o['map'] = val
        elif act == 'slot_civ':
            self.picker = val
            self.picker_sel = self.slot_civ(val)
        elif act == 'pick':
            self.picker_sel = val
        elif act == 'pick_ok':
            if self.picker is not None and self.picker_sel is not None:
                self.set_slot_civ(self.picker, self.picker_sel)
            self.picker = None
        elif act == 'pick_cancel':
            self.picker = None
        elif act == 'randomize':
            o['map'] = random.choice(maps.LOBBY)
            for i in self.active_slots():
                sl[i]['civ'] = random.choice(civ_ui.playable())
        elif act == 'reset':
            self.menu_cfg['slots'] = default_slots()
            self.menu_cfg['opts'] = match.defaults()
        elif act == 'play':
            if self.teams_ok():
                self.start_from_menu()

    def apply_choice(self, key, slot, value):
        o = self.opts()
        sl = self.slots()
        if key == 'player':
            kind, lv = value
            sl[slot]['kind'] = kind
            if kind == 'ai':
                sl[slot]['level'] = lv
            if len(self.active_slots()) < 2:
                sl[slot]['kind'] = 'ai'
            self.fix_colors()
        elif key == 'nplayers':
            self.set_players(value)
        elif key == 'ai_all':
            for i in self.active_slots():
                if sl[i]['kind'] == 'ai':
                    sl[i]['level'] = value
        elif key == 'mode':
            o['mode'] = value
        else:
            o[key] = value

    def lobby_click(self, pos):
        """ЛКМ в лобби: открытый список → окно выбора цивилизации → элементы экрана."""
        if self.dropdown is not None:
            anchor, key, slot, vals, lbls, idx = self.dropdown
            self.dropdown = None
            for r, i in W.list_rects(SCREEN_H, anchor, len(lbls)):
                if r.collidepoint(pos):
                    self.audio.click()
                    self.apply_choice(key, slot, vals[i])
                    return True
            return True
        if self.picker is not None:
            box, items = self.picker_rects()
            for r, act, val in items:
                if r.collidepoint(pos):
                    self.menu_action(act, val)
                    return True
            if not box.collidepoint(pos):
                self.picker = None
            return True
        return False

    def start_from_menu(self):
        cfg = self.cfg_defaults()
        sl = cfg['slots']
        act = self.active_slots()
        n = len(act)
        civs = [sl[i]['civ'] for i in act]
        colors = [sl[i]['color'] for i in act]
        levels = [None if sl[i]['kind'] == 'human' else sl[i]['level'] for i in act]
        teams = match.resolve_teams([sl[i]['team'] for i in act])
        o = dict(cfg['opts'])
        try:
            gsettings.put('lobby', {'slots': sl, 'opts': cfg['opts']})
        except Exception:
            pass
        args = dict(diff=1, opponents=n - 1, map_type=o.get('map', maps.DEFAULT), civs=civs, teams=teams, colors=colors,
                    levels=levels, settings=o)
        self.begin_loading(args)            # screens.py: экран загрузки → партия

    # ============================================================ отрисовка
    def draw_setup(self):
        scr = self.screen
        cfg = self.cfg_defaults()
        o = cfg['opts']
        sl = cfg['slots']
        S.shade_overlay(scr, (0, 0, SCREEN_W, SCREEN_H), (20, 10, 4), 120)
        S.panel(scr, SHEET, 'parchment', frame=False)
        W.plate(scr, (SCREEN_W // 2, 54), 'Схватка', self.fonts['h'], 320)
        mp = pygame.mouse.get_pos()
        modal = self.dropdown is not None or self.picker is not None
        hov = (lambda r: False) if modal else (lambda r: r.collidepoint(mp))
        f, fb = self.fonts['m'], self.fonts['b']
        # ---- игроки
        W.box(scr, PLAYERS)
        for x, lbl in ((PLAYERS.x + 120, 'Игрок'), (PLAYERS.x + 460, 'Цивилизация'), (PLAYERS.x + 626, 'Команда')):
            S.text(scr, lbl, (x, PLAYERS.y + 22), self.fonts['l'], W.INK, anchor='center', shadow=None)
        rects = self.setup_rects()
        for r, act, val in rects:
            h = hov(r)
            if act == 'color':
                W.color_badge(scr, r, PLAYER_COLORS[sl[val]['color']], val + 1, fb, h)
            elif act == 'player':
                s = sl[val]
                lbl = 'Закрыто' if s['kind'] == 'closed' else f'ИИ · {match.AI_LEVELS[s["level"]]}'
                W.field(scr, r, lbl, f, h, color=W.INK if s['kind'] != 'closed' else (120, 100, 76))
                if s['kind'] == 'ai':
                    for k in range(6):
                        c = (190, 50, 30) if k <= s['level'] else (170, 150, 116)
                        pygame.draw.circle(scr, c, (r.right - 90 + k * 11, r.centery), 4)
            elif act == 'slot_civ':
                key = sl[val]['civ']
                W.red_button(scr, r, civ_ui.civ_name(key), fb, 'hover' if h else 'normal')
                civ_ui.blit_emblem(self, key, (r.x + 6, r.y + 2, 24, 28))
            elif act == 'team':
                W.field(scr, r, '', f, h, arrow=False)
                S.text(scr, TEAM_LBL[sl[val]['team']], r.center, self.fonts['l'], W.INK, anchor='center',
                       shadow=None)
            elif act == 'nplayers':
                S.text(scr, 'Игроки', (PLAYERS.x + 50, r.centery), self.fonts['btn'], W.INK, anchor='midleft',
                       shadow=None)
                W.field(scr, r, str(len(self.active_slots())), fb, h)
            elif act == 'map':
                on = o.get('map', maps.DEFAULT) == val
                prev = self.map_preview(val, r.w - 8)
                pygame.draw.rect(scr, (40, 26, 12), r)
                scr.blit(prev, (r.x + 4, r.y + 4))
                fnt = self.fonts['bs'] if self.fonts['bs'].size(maps.name(val))[0] <= r.w - 6 else self.fonts['s']
                S.text(scr, maps.name(val), (r.centerx, r.bottom - 12), fnt,
                       (255, 240, 200) if on else (230, 214, 178), anchor='center')
                pygame.draw.rect(scr, (200, 40, 26) if on else (230, 184, 96) if h else (120, 84, 40), r,
                                 3 if on else 1)
        # «Вы» в первой строке
        r0 = pygame.Rect(PLAYERS.x + 56, ROW_Y0 + 5, 262, 28)
        W.field(scr, r0, gsettings.get('player_name', 'Игрок') + '  (вы)', fb, False, arrow=False)
        # местность
        W.box(scr, MAPBOX)
        S.text(scr, 'Местность', (MAPBOX.x + 16, MAPBOX.y + 15), self.fonts['l'], W.INK, anchor='midleft',
               shadow=None)
        side = match.map_side(o, len(self.active_slots()), o.get('map', maps.DEFAULT))
        S.text(scr, f'{side}×{side} · игроков: {len(self.active_slots())}', (MAPBOX.right - 16, MAPBOX.y + 15), fb,
               W.INK, anchor='midright', shadow=None)
        # ---- параметры
        W.box(scr, SETBOX)
        S.text(scr, 'Параметры игры', (SETBOX.centerx, SETBOX.y + 22), self.fonts['l'], W.INK, anchor='center',
               shadow=None)
        for key, y in self.setting_rows():
            lbl = 'Местность' if key == 'map' else match.LABEL[key]
            S.text(scr, lbl + ':', (SETBOX.x + 18, y + 15), fb, W.INK, anchor='midleft', shadow=None)
        for r, act, val in rects:
            h = hov(r)
            if act == 'opt':
                vals, lbls, idx = self.option_values(val)
                txt = lbls[idx] if idx is not None else 'Разные'
                if val == 'map':
                    W.red_button(scr, r, txt, fb, 'hover' if h else 'normal')
                else:
                    dm = val == 'resources' and o.get('mode') == 'dm'
                    W.field(scr, r, 'Смертельная схватка' if dm else txt, f, h, enabled=not dm)
            elif act == 'flag':
                lbl = next(lb for k, lb, _ in match.FLAGS if k == val)
                W.checkbox(scr, r, o.get(val), lbl, f, h)
            elif act in ('randomize', 'reset'):
                W.red_button(scr, r, 'Случайно' if act == 'randomize' else 'Сбросить', fb,
                             'hover' if h else 'normal')
            elif act == 'back':
                W.red_button(scr, r, 'В главное меню', fb, 'hover' if h else 'normal')
            elif act == 'play':
                ok = self.teams_ok()
                W.red_button(scr, r, 'Начать игру', fb, 'disabled' if not ok else 'hover' if h else 'normal')
                if not ok:
                    S.text(scr, 'Нужны хотя бы две команды', (r.centerx, r.y - 12), fb, (170, 30, 20),
                           anchor='center', shadow=None)
        fy = self.flags_y()
        S.text(scr, 'Команды', (SETBOX.x + 18, fy + 10), fb, (120, 30, 20), anchor='midleft', shadow=None)
        S.text(scr, 'Дополнительно', (SETBOX.x + 224, fy + 10), fb, (120, 30, 20), anchor='midleft', shadow=None)
        if self.picker is not None:
            self.draw_picker()
        if self.dropdown is not None:
            anchor, key, slot, vals, lbls, idx = self.dropdown
            rs = W.list_rects(SCREEN_H, anchor, len(lbls))
            hi = next((i for r, i in rs if r.collidepoint(mp)), None)
            W.dropdown_list(scr, anchor, lbls, f, idx, hi)

    def draw_picker(self):
        scr = self.screen
        S.shade_overlay(scr, (0, 0, SCREEN_W, SCREEN_H), alpha=150)
        box, items = self.picker_rects()
        S.panel(scr, box, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), box, 2)
        who = 'Ваша цивилизация' if self.picker == 0 else \
            f'Цивилизация: игрок {self.picker + 1}'
        W.plate(scr, (box.centerx, box.y + 30), who, self.fonts['h'], 420)
        mp = pygame.mouse.get_pos()
        sel = self.picker_sel
        for r, act, key in items:
            h = r.collidepoint(mp)
            if act == 'pick':
                on = key == sel
                pygame.draw.rect(scr, (230, 212, 170) if not on else (250, 236, 200), r)
                civ_ui.blit_emblem(self, key, (r.centerx - 26, r.y + 8, 52, 60))
                S.text(scr, civ_ui.civ_name(key), (r.centerx, r.bottom - 14), self.fonts['bs'], W.INK,
                       anchor='center', shadow=None)
                pygame.draw.rect(scr, (190, 40, 26) if on else (230, 184, 96) if h else (140, 104, 60), r,
                                 3 if on else 1)
            else:
                W.red_button(scr, r, 'Подтвердить' if act == 'pick_ok' else 'Отмена', self.fonts['b'],
                             'hover' if h else 'normal')
        card = pygame.Rect(box.x + 28 + 5 * 118 + 16, box.y + 70, box.right - (box.x + 28 + 5 * 118 + 16) - 28,
                           box.h - 150)
        civ_ui.draw_card(self, sel or 'random', card, compact=True)

    def map_preview(self, mt, size):
        """Значок карты (свой, из настоящей генерации — game/map_icons.py): size — сторона или (ш, в)."""
        from . import map_icons
        if isinstance(size, int):
            return map_icons.icon(mt, size)
        return _fit(map_icons.icon(mt, min(size)), size)

    def world_preview(self, w, size):
        """Превью уже созданной карты (экран загрузки) — тем же рисунком, что значки лобби."""
        from . import map_icons
        return _fit(map_icons.draw(w, min(size)), size)


def _fit(img, size):
    out = pygame.Surface(size)
    out.fill((20, 16, 12))
    out.blit(img, ((size[0] - img.get_width()) // 2, (size[1] - img.get_height()) // 2))
    return out
