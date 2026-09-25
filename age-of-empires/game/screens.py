"""Screens around a match (a mixin of ui.Game, placed before HudUI - overrides the match menu and the game end):

  * the loading screen (lobby -> game): a map preview, players, a tip, a progress bar; the world is built in steps;
  * the F10 menu: Return · Save · Load · Restart · Objectives · Controls · Civilization ·
    Settings · Resign · Exit to menu · Exit game (dangerous ones - with confirmation);
  * "Victory!/Defeat" -> "Achievements" (6 tabs: Summary, Military, Economy, Technology, Society, Timeline
    with a population graph) -> "Play again" / "Main menu";
  * autosave, quick save/load (F7/F8, game/keymap.py), "Lock speed".
The settings and saves windows - game/settings_ui.py, game/saves_ui.py.
"""
import random

import pygame

from .data import SCREEN_W, SCREEN_H, PLAYER_COLORS, AGE_NAMES
from . import civ_ui, i18n, keymap, match, naval, savegame, scoring, uiskin as S, widgets as W
from . import settings as gsettings
from .settings_ui import SettingsUI
from .saves_ui import SavesUI

# captions are locale keys (gm.*, confirm.*, tip.<n>, stats.*)
GAME_MENU = [('resume', 'gm.resume', 'call-to-arms'), ('save', 'gm.save', 'construction'),
             ('load', 'gm.load', 'upgrade'), ('restart', 'gm.restart', 'repair'),
             ('objectives', 'gm.objectives', 'victory'), ('help', 'gm.help', 'encyclopaedia'),
             ('civ', 'gm.civ', 'diplomacy'), ('settings', 'menu.settings', 'match-settings'),
             ('resign', 'gm.resign', 'defeat'), ('quit', 'gm.quit', 'cancel'),
             ('exit', 'gm.exit', 'cancel')]
CONFIRM = {'restart': 'confirm.restart', 'resign': 'confirm.resign', 'quit': 'confirm.quit', 'exit': 'confirm.exit'}

TIPS = ['tip.%d' % i for i in range(1, 13)]

STAT_TABS = [('score', 'stats.score', 'victory'), ('military', 'stats.military', 'kill'),
             ('economy', 'stats.economy', 'economics'), ('tech', 'stats.tech', 'upgrade'),
             ('society', 'stats.society', 'population'), ('timeline', 'stats.timeline', 'time')]


def _clock(t):
    if t is None:
        return '—'
    t = int(t)
    return f'{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}' if t >= 3600 else f'{t // 60:02d}:{t % 60:02d}'


def stat_columns(tab):
    """[(caption, icon, function(w, p, s, sc) -> a number or None, format)] for the achievements tab."""
    T = i18n.t
    if tab == 'score':
        return [(T('score.military'), 'kill', lambda w, p, s, sc: sc['military'], None),
                (T('score.economy'), 'economics', lambda w, p, s, sc: sc['economy'], None),
                (T('score.technology'), 'upgrade', lambda w, p, s, sc: sc['technology'], None),
                (T('score.society'), 'population', lambda w, p, s, sc: sc['society'], None),
                (T('stats.total'), 'victory', lambda w, p, s, sc: sc['total'], None)]
    if tab == 'military':
        return [(T('stats.kills'), 'kill', lambda w, p, s, sc: s['kills'], None),
                (T('stats.losses'), 'defeat', lambda w, p, s, sc: s['losses'], None),
                (T('stats.razed'), 'repair', lambda w, p, s, sc: s['razed'], None),
                (T('stats.bld_lost'), 'construction', lambda w, p, s, sc: s['bld_lost'], None),
                (T('stats.converted'), 'heal', lambda w, p, s, sc: s['converted'], None),
                (T('stats.army_max'), 'call-to-arms', lambda w, p, s, sc: s['army_max'], None)]
    if tab == 'economy':
        return [(T('res.food'), 'food', lambda w, p, s, sc: int(p.gathered.get('food', 0)), None),
                (T('res.wood'), 'wood', lambda w, p, s, sc: int(p.gathered.get('wood', 0)), None),
                (T('res.gold'), 'gold', lambda w, p, s, sc: int(p.gathered.get('gold', 0)), None),
                (T('res.stone'), 'stone', lambda w, p, s, sc: int(p.gathered.get('stone', 0)), None),
                (T('stats.trib_sent'), 'bribes', lambda w, p, s, sc: int(s['trib_sent']), None),
                (T('stats.trib_recv'), 'bribes', lambda w, p, s, sc: int(s['trib_recv']), None),
                (T('stats.trade'), 'economics', lambda w, p, s, sc: int(s['trade']), None)]
    if tab == 'tech':
        return [(T('age.short.1'), None, lambda w, p, s, sc: s['age_t'][1], 'time'),
                (T('age.short.2'), None, lambda w, p, s, sc: s['age_t'][2], 'time'),
                (T('age.short.3'), None, lambda w, p, s, sc: s['age_t'][3], 'time'),
                (T('stats.techs'), 'upgrade', lambda w, p, s, sc: s['techs'], None),
                (T('stats.explored'), 'portraits/technologies/cartography.png',
                 lambda w, p, s, sc: int(round(s['explored'] * 100)), '%')]
    if tab == 'society':
        return [(T('stats.castles'), 'production', lambda w, p, s, sc: s['castles'], None),
                (T('stats.vil_max'), 'economics', lambda w, p, s, sc: s['vil_max'], None),
                (T('stats.pop_max'), 'population', lambda w, p, s, sc: s['pop_max'], None),
                (T('stats.wonders'), 'victory', lambda w, p, s, sc: None, None),
                (T('stats.relics'), 'heal', lambda w, p, s, sc: None, None)]
    return []


class ScreensUI(SettingsUI, SavesUI):
    load_args = None
    load_step = 0
    stats_tab = 'score'
    confirm = None
    autosave_t = 0.0
    gameover_seen = False
    last_start = None

    def apply_startup_settings(self):
        self.settings = gsettings.data()        # the live settings dict (hud.py reads it through hud_opt)
        cur = getattr(self, 'cursors', None)
        if cur is not None:
            cur.enabled = bool(gsettings.get('cursor', True))
            soft = gsettings.get('cursor_soft')
            if soft is None:                    # auto: on Retina (window scale > 1) - the software cursor
                soft = S.backing_scale() > 1.0
            cur.set_soft(bool(soft))
        if gsettings.get('fullscreen'):
            try:
                pygame.display.toggle_fullscreen()
            except Exception:
                pass

    # ============================================================ loading
    def begin_loading(self, args):
        self.load_args = dict(args)
        self.load_step = 0
        self.load_t0 = pygame.time.get_ticks()
        self.load_tip = random.choice(TIPS)
        self.load_prev = None
        self.picker = None
        self.dropdown = None
        self.state = 'loading'

    def loading_frame(self, fast=False):
        """One step of the loading screen: draw, then carry out the next step of building the match."""
        steps = ['load.step1', 'load.step2', 'load.step3', 'load.done']
        self.draw_loading(self.load_step / (len(steps) - 1), i18n.t(steps[min(self.load_step, len(steps) - 1)]))
        st = self.load_step
        if st == 1:
            self.last_start = dict(self.load_args)
            self.make_world(**self.load_args)
            self.load_prev = self.world_preview(self.world, (440, 290))
        elif st == 2:
            self.attach_world()
            self.state = 'loading'
        elif st >= 3:
            if fast or pygame.time.get_ticks() - self.load_t0 > 900:
                self.state = 'play'
                self.audio.click()
            return
        self.load_step += 1

    def finish_loading(self):
        """Run the loading to the end at once (tools, checks)."""
        for _ in range(10):
            if self.state != 'loading':
                break
            self.loading_frame(fast=True)

    def draw_loading(self, prog, label):
        scr = self.screen
        scr.fill((18, 12, 6))
        S.panel(scr, pygame.Rect(24, 12, SCREEN_W - 48, SCREEN_H - 24), 'parchment', frame=False)
        a = self.load_args or {}
        o = match.normalize(a.get('settings'))
        mt = a.get('map_type', 'land')
        n = 1 + max(1, min(7, a.get('opponents', 1)))
        W.plate(scr, (SCREEN_W // 2, 54), f'{naval.MAP_NAMES.get(mt, mt)} · {match.map_side(o, n, mt)}×'
                f'{match.map_side(o, n, mt)}',
                self.fonts['h'], 420)
        # map preview
        pv = pygame.Rect(70, 110, 460, 310)
        W.box(scr, pv, 60)
        img = self.load_prev if self.load_prev is not None else self.map_preview(mt, (440, 290))
        scr.blit(img, (pv.x + 10, pv.y + 10))
        # parameters
        T = i18n.t
        rows = [('match-settings', match.value_label('mode', o['mode'])),
                ('economics', T('match.opt.resources') + ': ' + match.value_label('resources', o['resources'])),
                ('population', T('match.opt.pop') + f': {o["pop"]}'),
                ('upgrade', T('load.age') + ': ' + match.value_label('start_age', o['start_age'])),
                ('victory', T('match.opt.victory') + ': ' + match.value_label('victory', o['victory'])),
                ('time', T('match.opt.treaty') + ': ' + match.value_label('treaty', o['treaty']))]
        for i, (ic, txt) in enumerate(rows):
            x, y = 80 + (i % 2) * 230, pv.bottom + 26 + (i // 2) * 30
            S.blit_icon(scr, ic, (x + 10, y), 22)
            S.text_fit(scr, txt, (x + 28, y), self.fonts['b'], W.INK, anchor='midleft', shadow=None, max_w=200)
        # players
        pl = pygame.Rect(570, 110, 640, 420)
        W.box(scr, pl, 60)
        S.text(scr, T('lobby.players'), (pl.centerx, pl.y + 22), self.fonts['l'], W.INK, anchor='center', shadow=None)
        civs = list(a.get('civs') or [])
        cols = list(a.get('colors') or [])
        teams = list(a.get('teams') or [])
        levels = list(a.get('levels') or [])
        for i in range(n):
            y = pl.y + 52 + i * 44
            col = PLAYER_COLORS[cols[i]] if i < len(cols) and cols[i] is not None else PLAYER_COLORS[i]
            W.color_badge(scr, (pl.x + 16, y + 4, 30, 30), col, i + 1, self.fonts['b'])
            civ = civs[i] if i < len(civs) else 'random'
            if self.world is not None and i < len(self.world.players) and self.load_step >= 2:
                civ = self.world.players[i].civ
            civ_ui.blit_emblem(self, civ, (pl.x + 60, y + 2, 30, 34))
            who = i18n.player_name() if i == 0 else T('lobby.ai_slot', level=match.ai_level_name(
                levels[i] if i < len(levels) and levels[i] is not None else 2))
            S.text_fit(scr, who, (pl.x + 100, y + 19), self.fonts['b'], W.INK, anchor='midleft', shadow=None, max_w=250)
            S.text_fit(scr, civ_ui.civ_name(civ), (pl.x + 360, y + 19), self.fonts['b'], (110, 40, 20),
                       anchor='midleft', shadow=None, max_w=170)
            if i < len(teams):
                S.text(scr, T('win.team_n', n=teams[i] + 1), (pl.right - 20, y + 19), self.fonts['m'], W.INK,
                       anchor='midright', shadow=None)
        # tip
        tip = pygame.Rect(70, 560, SCREEN_W - 140, 80)
        W.box(scr, tip, 40)
        S.blit_icon(scr, 'encyclopaedia', (tip.x + 34, tip.centery), 40)
        S.text(scr, T('load.tip'), (tip.x + 70, tip.y + 20), self.fonts['bs'], (140, 40, 20), anchor='midleft', shadow=None)
        S.text_fit(scr, T(getattr(self, 'load_tip', TIPS[0])), (tip.x + 70, tip.y + 48), self.fonts['m'], W.INK,
                   anchor='midleft', shadow=None, max_w=tip.w - 90)
        # progress
        bar = pygame.Rect(70, 680, SCREEN_W - 140, 26)
        pygame.draw.rect(scr, (60, 40, 20), bar)
        pygame.draw.rect(scr, (180, 40, 26), (bar.x + 2, bar.y + 2, int((bar.w - 4) * min(1.0, prog)), bar.h - 4))
        pygame.draw.rect(scr, (230, 184, 96), bar, 2)
        S.text(scr, f'{label}  {int(min(1.0, prog) * 100)}%', bar.center, self.fonts['b'], (255, 240, 210),
               anchor='center')

    # ============================================================ autosave and "hot" windows
    def after_update(self, dt):
        mins = gsettings.get('autosave', 0) or 0
        w = self.world
        if not mins or w is None or w.winner is not None:
            return
        self.autosave_t += dt
        if self.autosave_t >= mins * 60:
            self.autosave_t = 0.0
            try:
                savegame.save_world(w, savegame.AUTOSAVE, i18n.t('saves.autosave'),
                                    ui=self.ui_state(),
                                    thumb=self.screen.copy())
                w.msg(i18n.t('saves.autosave'), (170, 200, 230))
            except Exception:
                pass

    def overlay_event(self, e):
        """Events before the game's regular input: the open F10 windows, quick keys, the locked speed."""
        h = self.help
        if h == 'settings':
            if self.settings_event(e):
                return True
            return e.type in (pygame.KEYDOWN, pygame.MOUSEBUTTONDOWN)
        if h in ('save', 'load'):
            self.saves_event(e)
            return e.type in (pygame.KEYDOWN, pygame.MOUSEBUTTONDOWN, pygame.MOUSEWHEEL)
        if h == 'confirm' and e.type == pygame.KEYDOWN:
            if e.key in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_y):
                self.confirm_yes()
            elif e.key in (pygame.K_ESCAPE, pygame.K_n):
                self.help = 'menu'
            return True
        if e.type == pygame.KEYDOWN and not getattr(self, '_kbypass', False) and \
                not (h in ('save', 'load', 'settings') or getattr(self, 'window', None) == 'chat'):
            tr = keymap.translate(e.key)        # remapped keys (Settings -> Hotkeys)
            if tr == 'swallow':
                return True
            if tr is not None:
                self._kbypass = True
                try:
                    self.on_event(pygame.event.Event(pygame.KEYDOWN, key=tr, mod=getattr(e, 'mod', 0), unicode='',
                                                     scancode=0))
                finally:
                    self._kbypass = False
                return True
        if e.type == pygame.KEYDOWN and not h:
            byp = getattr(self, '_kbypass', False)

            def act(name):              # after remapping the input arrives with the default key
                return e.key == keymap.default_code(name) if byp else keymap.matches(name, e.key)
            if act('quick_save'):
                self.do_save('quicksave', i18n.t('saves.quicksave'))
                return True
            if act('quick_load'):
                if any(s == 'quicksave' for s, _, _ in savegame.list_slots()):
                    self.do_load('quicksave')
                return True
            w = self.world
            if w is not None and w.settings.get('lock_speed') and \
                    (act('speed_up') or act('speed_down')):
                w.msg(i18n.t('msg.speed_locked'), (230, 200, 150))
                return True
        return False

    # ============================================================ F10 menu
    def game_menu_rects(self):
        bh, gap = 44, 6
        box = pygame.Rect(SCREEN_W // 2 - 200, 56, 400, 90 + len(GAME_MENU) * (bh + gap))
        return box, [(pygame.Rect(box.x + 40, box.y + 70 + i * (bh + gap), box.w - 80, bh), act, lbl, ic)
                     for i, (act, lbl, ic) in enumerate(GAME_MENU)]

    def draw_game_menu(self):
        scr = self.screen
        self.dim(150)
        box, items = self.game_menu_rects()
        S.panel(scr, box, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), box, 2)
        W.plate(scr, (box.centerx, box.y + 32), i18n.t('hud.menu'), self.fonts['h'], 220)
        mp = pygame.mouse.get_pos()
        for r, act, lbl, ic in items:
            h = r.collidepoint(mp)
            W.red_button(scr, r, i18n.t(lbl), self.fonts['b'], 'hover' if h else 'normal', icon=ic)

    def game_menu_action(self, act):
        w = self.world
        if act == 'resume':
            self.help = False
        elif act == 'save':
            self.open_saves('save')
        elif act == 'load':
            self.open_saves('load')
        elif act == 'objectives':
            if hasattr(self, 'toggle_window'):          # hud.py: the "Objectives" window (hud_windows.draw_objectives)
                self.help = False
                self.window = 'objectives'
            else:
                self.help = 'objectives'
        elif act == 'help':
            self.help = True
        elif act == 'civ':
            self.help = 'civ'
        elif act == 'settings':
            self.open_settings(back='game')
        elif act in CONFIRM:
            if act == 'resign' and not w.players[w.human].alive:
                return
            self.confirm = act
            self.help = 'confirm'

    def confirm_yes(self):
        act = self.confirm
        self.confirm = None
        self.help = False
        w = self.world
        if act == 'restart' and self.last_start:
            self.begin_loading(self.last_start)
        elif act == 'resign':
            w.resign(w.human)
        elif act == 'quit':
            self.open_stats()
        elif act == 'exit':
            self.running = False

    def confirm_rects(self):
        box = pygame.Rect(SCREEN_W // 2 - 240, 280, 480, 180)
        return box, [(pygame.Rect(box.x + 40, box.bottom - 64, 180, 42), 'yes'),
                     (pygame.Rect(box.right - 220, box.bottom - 64, 180, 42), 'no')]

    def overlay_click(self, pos):
        """Left click while a window is open (the F10 menu, a confirmation, objectives; the rest - as in hud.py)."""
        h = self.help
        if h == 'menu':
            box, items = self.game_menu_rects()
            for r, act, _, _ in items:
                if r.collidepoint(pos):
                    self.audio.click()
                    self.game_menu_action(act)
                    return
            if not box.collidepoint(pos):
                self.help = False
            return
        if h == 'confirm':
            box, items = self.confirm_rects()
            for r, act in items:
                if r.collidepoint(pos):
                    self.audio.click()
                    if act == 'yes':
                        self.confirm_yes()
                    else:
                        self.help = 'menu'
            return
        if h == 'objectives':
            self.help = False
            return
        sup = getattr(super(), 'overlay_click', None)
        if sup is not None:
            sup(pos)
        else:
            self.help = False

    def draw_help(self):
        h = self.help
        if h == 'settings':
            self.dim(140)
            self.draw_settings_panel()
        elif h in ('save', 'load'):
            self.draw_saves()
        elif h == 'confirm':
            self.draw_game_menu()
            self.draw_confirm()
        elif h == 'objectives':
            self.draw_objectives()
        else:
            super().draw_help()

    def draw_confirm(self):
        scr = self.screen
        S.shade_overlay(scr, (0, 0, SCREEN_W, SCREEN_H), alpha=90)
        box, items = self.confirm_rects()
        S.panel(scr, box, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), box, 2)
        S.text_fit(scr, i18n.t(CONFIRM.get(self.confirm, '?')), (box.centerx, box.y + 52), self.fonts['l'], W.INK,
                   anchor='center', shadow=None, max_w=box.w - 30)
        mp = pygame.mouse.get_pos()
        for r, act in items:
            W.red_button(scr, r, i18n.t('common.yes') if act == 'yes' else i18n.t('common.no'), self.fonts['b'],
                         'hover' if r.collidepoint(mp) else 'normal')

    def draw_objectives(self):
        """The fallback "Objectives" window (if hud has none of its own): the goal and match parameters."""
        scr = self.screen
        w = self.world
        self.dim(150)
        box = pygame.Rect(SCREEN_W // 2 - 300, 150, 600, 420)
        S.panel(scr, box, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), box, 2)
        T = i18n.t
        W.plate(scr, (box.centerx, box.y + 32), T('gm.objectives'), self.fonts['h'], 260)
        o = w.settings
        v = o.get('victory', 'standard')
        goal = {'time': T('obj.goal_time', n=o.get('victory_time')),
                'score': T('obj.goal_score', n=o.get('victory_score'))}.get(v, T('obj.goal_conquest'))
        rows = [('victory', goal),
                ('portraits/technologies/cartography.png', f'{naval.MAP_NAMES.get(w.map_type, "")} · {w.W}²'),
                ('match-settings', match.value_label('mode', o.get('mode'))),
                ('time', T('match.opt.treaty') + ': ' + (_clock(match.treaty_left(w)) if match.treaty_active(w)
                                                        else T('common.none'))),
                ('population', T('match.opt.pop') + f': {w.pop_limit}'),
                ('upgrade', T('match.opt.end_age') + ': ' + AGE_NAMES[w.max_age])]
        for i, (ic, txt) in enumerate(rows):
            y = box.y + 90 + i * 48
            S.blit_icon(scr, ic, (box.x + 44, y), 30)
            S.text_fit(scr, txt, (box.x + 74, y), self.fonts['b'], W.INK, anchor='midleft', shadow=None,
                       max_w=box.right - box.x - 90)

    # ============================================================ end of the match
    def gameover_rects(self):
        box = pygame.Rect(SCREEN_W // 2 - 280, 170, 560, 360)
        return box, [(pygame.Rect(box.centerx - 150, box.y + 196 + i * 50, 300, 42), act, lbl)
                     for i, (act, lbl) in enumerate((('stats', 'end.stats'), ('stay', 'end.stay'),
                                                     ('menu', 'menu.main')))]

    def draw_gameover(self):
        w = self.world
        if self.gameover_seen:           # "Stay on the map" - only the plate at the top
            win = w.human_won()
            self.text(i18n.t('end.victory').upper() if win else i18n.t('end.defeat').upper(), (SCREEN_W // 2, 60), 'h',
                      (255, 230, 150) if win else (255, 160, 130), anchor='center')
            return
        scr = self.screen
        self.dim(150)
        win = w.human_won()
        box, items = self.gameover_rects()
        S.panel(scr, box, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), box, 2)
        S.blit_icon(scr, 'victory' if win else 'defeat', (box.centerx, box.y + 60), 90)
        img = S.gold_text(i18n.t('end.victory_bang').upper() if win else i18n.t('end.defeat').upper(), self.fonts['xl'],
                          *(((255, 240, 170), (210, 150, 50)) if win else ((255, 170, 140), (160, 40, 30))))
        scr.blit(img, img.get_rect(center=(box.centerx, box.y + 140)))
        mp = pygame.mouse.get_pos()
        for r, act, lbl in items:
            W.red_button(scr, r, i18n.t(lbl), self.fonts['b'], 'hover' if r.collidepoint(mp) else 'normal')

    def gameover_event(self, e):
        if e.type == pygame.KEYDOWN and e.key in (pygame.K_RETURN, pygame.K_SPACE, pygame.K_KP_ENTER):
            self.open_stats()
        elif e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE:
            self.gameover_seen = True
        elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            _, items = self.gameover_rects()
            for r, act, _ in items:
                if r.collidepoint(e.pos):
                    self.audio.click()
                    if act == 'stats':
                        self.open_stats()
                    elif act == 'stay':
                        self.gameover_seen = True
                    else:
                        self.state = 'menu'
                        self.menu_screen = 'main'

    # ============================================================ achievements
    def open_stats(self):
        self.help = False
        self.stats_tab = 'score'
        self.state = 'stats'

    def stats_rects(self):
        items = []
        tw = (SCREEN_W - 120) // len(STAT_TABS)
        for i, (tid, _, _) in enumerate(STAT_TABS):
            items.append((pygame.Rect(60 + i * tw, SCREEN_H - 118, tw - 8, 40), 'tab', tid))
        items.append((pygame.Rect(SCREEN_W - 540, SCREEN_H - 66, 230, 42), 'again', None))
        items.append((pygame.Rect(SCREEN_W - 290, SCREEN_H - 66, 230, 42), 'menu', None))
        return items

    def screen_event(self, e):
        if self.state == 'loading':
            return
        if e.type == pygame.KEYDOWN:
            if e.key in (pygame.K_ESCAPE, pygame.K_RETURN, pygame.K_KP_ENTER):
                self.state = 'menu'
                self.menu_screen = 'main'
            elif e.key in (pygame.K_LEFT, pygame.K_RIGHT, pygame.K_TAB):
                ids = [t for t, _, _ in STAT_TABS]
                i = ids.index(self.stats_tab) + (-1 if e.key == pygame.K_LEFT else 1)
                self.stats_tab = ids[i % len(ids)]
        elif e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            for r, act, val in self.stats_rects():
                if r.collidepoint(e.pos):
                    self.audio.click()
                    if act == 'tab':
                        self.stats_tab = val
                    elif act == 'again' and self.last_start:
                        self.begin_loading(self.last_start)
                    elif act == 'menu':
                        self.state = 'menu'
                        self.menu_screen = 'main'

    def draw_stats(self):
        scr = self.screen
        w = self.world
        scr.fill((18, 12, 6))
        sheet = pygame.Rect(24, 12, SCREEN_W - 48, SCREEN_H - 24)
        S.panel(scr, sheet, 'parchment', frame=False)
        title = i18n.t(next(lbl for t, lbl, _ in STAT_TABS if t == self.stats_tab))
        W.plate(scr, (SCREEN_W // 2, 50), i18n.t('end.stats') + ' · ' + title, self.fonts['h'], 460)
        S.text(scr, _clock(w.time), (SCREEN_W - 60, 50), self.fonts['l'], W.INK, anchor='midright', shadow=None)
        win = w.winner
        if win is not None:
            S.text(scr, i18n.t('end.victory_bang') if w.human_won() else i18n.t('end.defeat'), (70, 50), self.fonts['l'],
                   (40, 120, 40) if w.human_won() else (160, 30, 20), anchor='midleft', shadow=None)
        mp = pygame.mouse.get_pos()
        area = pygame.Rect(50, 90, SCREEN_W - 100, SCREEN_H - 230)
        if self.stats_tab == 'timeline':
            self.draw_timeline(area)
        else:
            self.draw_stat_table(area)
        for r, act, val in self.stats_rects():
            h = r.collidepoint(mp)
            if act == 'tab':
                tid, lbl, ic = next(t for t in STAT_TABS if t[0] == val)
                W.tab(scr, r, i18n.t(lbl), self.fonts['b'], self.stats_tab == val, h, ic)
            elif act == 'again':
                W.red_button(scr, r, i18n.t('end.play_again'), self.fonts['b'],
                             'disabled' if not self.last_start else 'hover' if h else 'normal')
            else:
                W.red_button(scr, r, i18n.t('menu.main'), self.fonts['b'], 'hover' if h else 'normal')

    def banner(self, r, p):
        """The player ribbon on the left (color, name, civilization) - like flags on the achievements sheet."""
        scr = self.screen
        col = p.color
        pts = [(r.x, r.y), (r.right - 18, r.y), (r.right, r.centery), (r.right - 18, r.bottom), (r.x, r.bottom)]
        pygame.draw.polygon(scr, (30, 18, 8), [(x + 2, y + 2) for x, y in pts])
        pygame.draw.polygon(scr, col, pts)
        pygame.draw.polygon(scr, (240, 220, 180), pts, 1)
        civ_ui.blit_emblem(self, p.civ, (r.x + 6, r.y + 4, 26, r.h - 8))
        name = i18n.player_name() if p.id == self.world.human else p.name
        S.text_fit(scr, name, (r.x + 40, r.y + 14), self.fonts['b'], (255, 255, 255), anchor='midleft',
                   shadow=(0, 0, 0), max_w=r.w - 60)
        S.text(scr, civ_ui.civ_name(p.civ), (r.x + 40, r.y + 32), self.fonts['s'], (250, 240, 220),
               anchor='midleft', shadow=(0, 0, 0))

    def draw_stat_table(self, area):
        scr = self.screen
        w = self.world
        cols = stat_columns(self.stats_tab)
        scs = scoring.scores(w)
        n = len(w.players)
        rh = min(62, (area.h - 50) // max(1, n))
        x0 = area.x + 250
        cw = (area.right - 90 - x0) // max(1, len(cols))
        vals = [[fn(w, p, w.stats[p.id], scs[p.id]) for _, _, fn, _ in cols] for p in w.players]
        for j, (lbl, ic, fn, fmt) in enumerate(cols):
            cx = x0 + j * cw + cw // 2
            if ic:
                S.blit_icon(scr, ic, (cx, area.y + 14), 24)
            elif j < 3 and self.stats_tab == 'tech':
                a = S.portrait('age', j + 1, None, 26)
                if a is not None:
                    scr.blit(a, a.get_rect(center=(cx, area.y + 14)))
            S.text_fit(scr, lbl, (cx, area.y + 38), self.fonts['bs'], W.INK, anchor='center', shadow=None, max_w=cw - 6)
            col_vals = [v[j] for v in vals if v[j] is not None]
            best = (min(col_vals) if fmt == 'time' else max(col_vals)) if col_vals else None
            bar_max = max(col_vals) if col_vals and fmt != 'time' else 0
            for i, p in enumerate(w.players):
                v = vals[i][j]
                y = area.y + 56 + i * rh
                if fmt == 'time':
                    txt = _clock(v) if v else ('—' if v is None else '00:00')
                elif v is None:
                    txt = '—'
                else:
                    txt = f'{v}%' if fmt == '%' else str(v)
                hi = v is not None and v == best and len(col_vals) > 1 and (fmt == 'time' or v > 0)
                S.text(scr, txt, (cx, y + rh // 2 - 6), self.fonts['l'], (170, 30, 20) if hi else W.INK,
                       anchor='center', shadow=None)
                if bar_max and v:
                    bw = int((cw - 30) * v / bar_max)
                    pygame.draw.rect(scr, p.color, (cx - (cw - 30) // 2, y + rh // 2 + 10, bw, 5))
            pygame.draw.line(scr, (170, 130, 80), (x0 + j * cw, area.y + 4), (x0 + j * cw, area.y + 56 + n * rh), 1)
        for i, p in enumerate(w.players):
            y = area.y + 56 + i * rh
            self.banner(pygame.Rect(area.x, y + 4, 236, min(48, rh - 8)), p)
            tx = area.right - 50
            S.text(scr, i18n.t('stats.team_short', n=p.team + 1), (tx, y + rh // 2 - 4), self.fonts['b'], W.INK,
                   anchor='center', shadow=None)
            if w.winner is not None and p.team == w.winner:
                S.blit_icon(scr, 'victory', (tx + 28, y + rh // 2 - 4), 22)
            elif not p.alive:
                S.blit_icon(scr, 'defeat', (tx + 28, y + rh // 2 - 4), 20)
        S.text_fit(scr, i18n.t('lobby.team'), (area.right - 50, area.y + 38), self.fonts['bs'], W.INK, anchor='center',
                   shadow=None, max_w=96)

    def draw_timeline(self, area):
        """A population graph of all players by samples every 30 s + marks of ages (II, III, IV) and defeats."""
        scr = self.screen
        w = self.world
        W.box(scr, area, 30)
        g = area.inflate(-120, -80).move(30, 6)
        tmax = max(60.0, w.time)
        pmax = 10
        for s in w.stats:
            for smp in s['samples']:
                pmax = max(pmax, smp[1])
        pmax = int((pmax + 9) // 10 * 10)
        # grid
        for k in range(5):
            y = g.bottom - g.h * k / 4
            pygame.draw.line(scr, (190, 160, 110), (g.x, y), (g.right, y), 1)
            S.text(scr, str(int(pmax * k / 4)), (g.x - 8, y), self.fonts['s'], W.INK, anchor='midright', shadow=None)
        step = 60 * max(1, int(tmax / 60 / 8))
        t = 0
        while t <= tmax:
            x = g.x + g.w * t / tmax
            pygame.draw.line(scr, (200, 176, 130), (x, g.y), (x, g.bottom), 1)
            S.text(scr, i18n.t('stats.min_short', n=int(t // 60)), (x, g.bottom + 12), self.fonts['s'], W.INK,
                   anchor='center', shadow=None)
            t += step
        pygame.draw.rect(scr, (120, 84, 40), g, 2)
        S.text(scr, i18n.t('match.opt.pop'), (g.x, g.y - 16), self.fonts['bs'], W.INK, anchor='midleft', shadow=None)
        for p in w.players:
            s = w.stats[p.id]
            pts = [(g.x + g.w * smp[0] / tmax, g.bottom - g.h * smp[1] / pmax) for smp in s['samples']]
            if len(pts) >= 2:
                pygame.draw.lines(scr, (30, 20, 10), False, [(x + 1, y + 1) for x, y in pts], 3)
                pygame.draw.lines(scr, p.color, False, pts, 3)
            # ages - diamonds with a number
            for a, ta in enumerate(s['age_t'][1:], start=1):
                if ta is None or ta <= 0:
                    continue
                x = g.x + g.w * ta / tmax
                y = g.bottom - g.h * self._pop_at(s, ta) / pmax
                pts2 = [(x, y - 8), (x + 7, y), (x, y + 8), (x - 7, y)]
                pygame.draw.polygon(scr, p.color, pts2)
                pygame.draw.polygon(scr, (20, 10, 4), pts2, 1)
                S.text(scr, ('II', 'III', 'IV')[a - 1], (x, y - 16), self.fonts['s'], W.INK, anchor='center',
                       shadow=None)
            if s.get('defeat_t') is not None:
                x = g.x + g.w * s['defeat_t'] / tmax
                y = g.bottom - g.h * self._pop_at(s, s['defeat_t']) / pmax
                pygame.draw.line(scr, (160, 20, 10), (x - 6, y - 6), (x + 6, y + 6), 3)
                pygame.draw.line(scr, (160, 20, 10), (x - 6, y + 6), (x + 6, y - 6), 3)
        # the legend - a line above the graph
        for i, p in enumerate(w.players):
            lx = g.x + 150 + (i % 4) * 230
            ly = area.y + 10 + (i // 4) * 16
            pygame.draw.rect(scr, p.color, (lx, ly - 4, 22, 8))
            name = i18n.player_name() if p.id == w.human else p.name
            S.text_fit(scr, f'{name} · {civ_ui.civ_name(p.civ)}', (lx + 28, ly), self.fonts['s'], W.INK,
                       anchor='midleft', shadow=None, max_w=196)

    @staticmethod
    def _pop_at(s, t):
        best = 0
        for smp in s['samples']:
            if smp[0] <= t:
                best = smp[1]
        return best

