"""The main menu (a mixin of ui.Game) - the AoE2 DE layout:
a column on the left: the title, three illustrated tiles (Single Player · Multiplayer · Learn to Play), an ornament,
"News", "Exit"; top right - settings gear, profile, volume; on the right - the news feed;
at the bottom center - the version line. The tiles are drawn from the game's sprites (game/menu_art.py).

Screens (menu_screen): 'main' · 'single' (the "Single Player" window: Skirmish, Campaigns, Scenarios, Load Game) ·
'setup' (the lobby, game/lobby.py) · 'learn' (tutorial) · 'news' · 'settings' (game/settings_ui.py) ·
'load' (game/saves_ui.py) · 'credits' (CREDITS.md with scrolling).
"""
import os
import random
import re
import subprocess

import pygame

from .data import SCREEN_W, SCREEN_H, TOP_H, VIEW_H, TILE
from . import i18n, menu_art, uiskin as S, widgets as W
from . import settings as gsettings

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

# ---- main menu
COL = pygame.Rect(0, 0, 400, SCREEN_H)                 # a dark column on the left (~1/3 of the width, as in DE)
TILE_W, TILE_H = 300, 146
MAIN_TILES = [('single', 'menu.single'), ('multi', 'menu.multi'), ('learn', 'menu.learn')]     # locale keys
# the "Single Player" window: (action, caption key, available)
SINGLE_TILES = [('skirmish', 'menu.skirmish', True), ('campaign', 'menu.campaigns', False),
                ('scenario', 'menu.scenarios', False), ('load_game', 'menu.load_game', True)]
SINGLE_BOX = pygame.Rect(SCREEN_W // 2 - 380 + COL.w // 2 - 60, 170, 760, 420)

NEWS_STATIC = ['menu_de', 'match_options', 'saves', 'ai_levels']       # news.<key>.title / .body

# tutorial cards: (icon, key; the title is learn.<key>.title, the lines are learn.<key>.1...n)
LEARN_CARDS = [('economics', 'eco', 3), ('construction', 'build', 2), ('call-to-arms', 'army', 2),
               ('upgrade', 'ages', 2), ('kill', 'victory', 2), ('encyclopaedia', 'keys', 2)]


def _git(*args):
    try:
        r = subprocess.run(['git', *args], cwd=ROOT, capture_output=True, text=True, timeout=1.5)
        return r.stdout.strip() if r.returncode == 0 else ''
    except Exception:
        return ''


_VERSION = None
_NEWS = None


def version_line():
    global _VERSION
    if _VERSION is None:
        _VERSION = (_git('rev-list', '--count', 'HEAD') or '0', _git('log', '-1', '--format=%cd', '--date=short'))
    n, d = _VERSION
    return i18n.t('menu.version', v='0.9.' + n) + (' · ' + i18n.t('menu.build', date=d) if d else '')


def news():
    """[(date, title)] - from the git history (if any), otherwise the built-in list."""
    global _NEWS
    if _NEWS is None:
        raw = _git('log', '--no-merges', '--format=%cd|%s', '--date=short', '-14')
        items = []
        for ln in raw.splitlines():
            if '|' in ln:
                d, s = ln.split('|', 1)
                if s.lower().startswith(('merge', 'слияние')):    # noqa: service commits
                    continue
                items.append((d, s))
        _NEWS = items
    return _NEWS or [('', f'{i18n.t("news." + k + ".title")}: {i18n.t("news." + k + ".body")}') for k in NEWS_STATIC]


def _wrap(f, s, width):
    out, cur = [], ''
    for wd in s.split(' '):
        t = (cur + ' ' + wd).strip()
        if f.size(t)[0] > width and cur:
            out.append(cur)
            cur = wd
        else:
            cur = t
    if cur:
        out.append(cur)
    return out


class MenuUI:
    menu_screen = 'main'
    credits_scroll = 0
    news_scroll = 0
    _credits = None

    # ============================================================ layout
    def main_rects(self):
        """[(rect, action, caption)] of the main menu."""
        items = []
        x = COL.centerx - TILE_W // 2
        for i, (act, lbl) in enumerate(MAIN_TILES):
            items.append((pygame.Rect(x, 150 + i * (TILE_H + 14), TILE_W, TILE_H), act, lbl))
        items.append((pygame.Rect(x, 668, TILE_W, 36), 'news', 'menu.news'))
        items.append((pygame.Rect(x, 714, TILE_W, 36), 'quit', 'menu.quit'))
        items.append((pygame.Rect(SCREEN_W - 316, 10, 40, 40), 'settings', 'menu.settings'))
        items.append((pygame.Rect(SCREEN_W - 268, 10, 200, 40), 'profile', 'menu.profile'))
        items.append((pygame.Rect(SCREEN_W - 196, SCREEN_H - 96, 180, 32), 'credits', 'menu.credits'))
        return items

    def single_rects(self):
        b = SINGLE_BOX
        items = []
        tw, th = 164, 250
        for i, (act, lbl, ok) in enumerate(SINGLE_TILES):
            items.append((pygame.Rect(b.x + 24 + i * (tw + 16), b.y + 70, tw, th), act, ok))
        items.append((pygame.Rect(b.centerx - 110, b.bottom - 62, 220, 40), 'back', True))
        return items

    def learn_rects(self):
        cx = (COL.right + SCREEN_W) // 2
        items = [(pygame.Rect(cx - 280, SCREEN_H - 90, 260, 44), 'tutorial', None),
                 (pygame.Rect(cx + 20, SCREEN_H - 90, 260, 44), 'back', None)]
        return items

    def menu_items(self):
        """[(rect, action, value)] - the active elements of the current menu screen."""
        scr = self.menu_screen
        if scr == 'setup':
            if self.picker is not None:
                return self.picker_rects()[1]
            return self.setup_rects()
        if scr == 'single':
            return [(r, act, ok) for r, act, ok in self.single_rects()]
        if scr == 'learn':
            return self.learn_rects()
        if scr in ('credits', 'news'):
            return [(pygame.Rect(SCREEN_W // 2 - 110, SCREEN_H - 70, 220, 44), 'back', None)]
        if scr == 'settings':
            return self.settings_rects()
        if scr == 'load':
            return self.saves_rects()
        return [(r, act, None) for r, act, _ in self.main_rects()]

    # ============================================================ actions
    def menu_action(self, act, val):
        self.audio.click()
        if act == 'single':
            self.menu_screen = 'single'
        elif act == 'profile':
            self.open_settings(back=self.menu_screen, tab='interface')
        elif act == 'multi':
            self.menu_toast = (i18n.t('menu.multi_later'), pygame.time.get_ticks())
        elif act == 'learn':
            self.menu_screen = 'learn'
        elif act == 'tutorial':
            self.start_tutorial()
        elif act == 'news':
            self.menu_screen = 'news'
            self.news_scroll = 0
        elif act == 'skirmish':
            self.menu_screen = 'setup'
            self.picker = None
            self.dropdown = None
        elif act in ('campaign', 'scenario'):
            self.menu_toast = (i18n.t('menu.campaigns_soon'), pygame.time.get_ticks())
        elif act == 'load_game':
            self.open_saves('load', back='single')
        elif act == 'settings':
            self.open_settings(back=self.menu_screen)
        elif act == 'credits':
            self.menu_screen = 'credits'
            self.credits_scroll = 0
        elif act == 'back':
            self.menu_screen = {'setup': 'single', 'single': 'main'}.get(self.menu_screen, 'main')
            self.picker = None
            self.dropdown = None
        elif act == 'quit':
            self.running = False
        elif self.menu_screen == 'setup':
            self.lobby_action(act, val)
        elif self.menu_screen == 'settings':
            self.settings_action(act, val)
        elif self.menu_screen == 'load':
            self.saves_action(act, val)

    def start_tutorial(self):
        """Tutorial match: one "Easiest" opponent, a 20-minute treaty, normal speed."""
        st = dict(treaty=20, speed=1.5)
        self.begin_loading(dict(diff=0, opponents=1, map_type='land', civs=['franks', 'britons'], teams=[0, 1],
                                colors=None, levels=[None, 0], settings=st))

    def menu_event(self, e):
        scr = self.menu_screen
        if scr == 'settings' and self.settings_event(e):
            return
        if scr == 'load' and self.saves_event(e):
            return
        if e.type == pygame.MOUSEBUTTONDOWN and e.button == 1:
            if scr == 'setup' and self.lobby_click(e.pos):
                return
            for r, act, val in self.menu_items():
                if r.collidepoint(e.pos):
                    self.menu_action(act, val)
                    return
            if scr == 'single' and not SINGLE_BOX.collidepoint(e.pos):
                self.menu_screen = 'main'
        elif e.type == pygame.MOUSEWHEEL and scr in ('credits', 'news'):
            if scr == 'credits':
                self.credits_scroll -= e.y * 60
            else:
                self.news_scroll -= e.y * 60
        elif e.type == pygame.MOUSEBUTTONDOWN and e.button in (4, 5) and scr == 'credits':
            self.credits_scroll += 60 if e.button == 5 else -60
        elif e.type == pygame.KEYDOWN:
            k = e.key
            if k == pygame.K_ESCAPE:
                if scr == 'setup' and (self.picker is not None or self.dropdown is not None):
                    self.picker = None
                    self.dropdown = None
                elif scr != 'main':
                    self.menu_action('back', None)
                else:
                    self.running = False
            elif k in (pygame.K_RETURN, pygame.K_KP_ENTER, pygame.K_SPACE):
                if scr == 'main':
                    self.menu_action('single', None)
                elif scr == 'single':
                    self.menu_action('skirmish', None)
                elif scr == 'setup' and self.picker is None and self.dropdown is None:
                    self.menu_action('play', None)
            elif scr == 'credits' and k in (pygame.K_DOWN, pygame.K_UP, pygame.K_PAGEDOWN, pygame.K_PAGEUP):
                step = {pygame.K_DOWN: 40, pygame.K_UP: -40, pygame.K_PAGEDOWN: 400, pygame.K_PAGEUP: -400}[k]
                self.credits_scroll += step

    # ============================================================ background
    def menu_background(self):
        bg = getattr(self, 'menu_bg', None)
        if bg is not None:
            return bg
        bg = None
        if gsettings.get('live_menu_bg', True):
            try:
                bg = self.render_vista()
            except Exception:           # the background is decoration: on any error - a stone wall
                bg = None
                self.world = None
        if bg is None:
            bg = S.tiled('skin/stone_dark.png', (SCREEN_W, SCREEN_H), tint=(150, 140, 128)).copy()
        tint = pygame.Surface((SCREEN_W, SCREEN_H), pygame.SRCALPHA)
        tint.fill((40, 22, 6, 50))
        bg.blit(tint, (0, 0))
        self.menu_bg = bg
        return bg

    def render_vista(self):
        """A panorama: a small town on the game's map (real sprites), softly blurred."""
        state = random.getstate()
        saved = (self.state, dict(self.menu_cfg))
        zoom = self.zoom
        self.zoom = self.zoom_to = 1.0     # the panorama is always at the normal scale
        try:
            random.seed(11)
            self.new_game(1, 1, map_type='coast', civs=['britons', 'franks'])
            w = self.world
            p = w.players[0]
            for t in ('feudal', 'castle'):
                w.apply_tech(p, t)
            sx, sy = w.starts[0]
            plan = ['castle', 'market', 'barracks', 'monastery', 'house', 'house', 'blacksmith', 'house', 'stable',
                    'house', 'archery_range', 'house', 'mill', 'farm', 'farm', 'tower', 'house', 'lumber_camp']
            for kind in plan:
                done = False
                for r in range(4, 14):
                    for dx in range(-r, r + 1):
                        for dy in (-r, r, dx):
                            if not done and w.can_place(kind, sx + dx, sy + dy, 0, check_explored=False) \
                                    and random.random() < 0.35:
                                w.place_building(kind, 0, sx + dx, sy + dy, complete=True)
                                done = True
                    if done:
                        break
            w.ais = []
            for _ in range(160):
                w.update(0.05)
            w.events.clear()
            w.vis = bytearray(b'\x01' * (w.W * w.H))
            w.explored = bytearray(b'\x01' * (w.W * w.H))
            for b in w.buildings:
                b.seen = True
            w.fog_version += 1
            self.selected = []
            self.center_on(sx * TILE + 2 * TILE, sy * TILE + 2 * TILE)
            cx, cy = self.cam_x - 200, self.cam_y - (SCREEN_H - VIEW_H) / 2
            out = pygame.Surface((SCREEN_W, SCREEN_H))
            y = 0
            while y < SCREEN_H:
                self.cam_x, self.cam_y = cx, cy + y
                self.screen.fill((0, 0, 0))
                self.draw_world()
                h = min(VIEW_H, SCREEN_H - y)
                out.blit(self.screen, (0, y), (0, TOP_H, SCREEN_W, h))
                y += h
            small = pygame.transform.smoothscale(out, (SCREEN_W // 2, SCREEN_H // 2))
            return pygame.transform.smoothscale(small, (SCREEN_W, SCREEN_H))
        finally:
            random.setstate(state)
            self.zoom = self.zoom_to = zoom
            self.world = None
            self.state, cfg = saved
            self.menu_cfg.clear()
            self.menu_cfg.update(cfg)

    # ============================================================ drawing
    def draw_menu(self):
        scr = self.screen
        scr.blit(self.menu_background(), (0, 0))
        s = self.menu_screen
        if s == 'setup':
            self.draw_setup()
        elif s == 'credits':
            self.draw_credits()
        elif s == 'settings':
            self.draw_settings_screen()
        elif s == 'load':
            self.draw_saves()
        else:
            self.draw_main()
            if s == 'single':
                self.draw_single()
            elif s == 'news':
                self.draw_news()
            elif s == 'learn':
                self.draw_learn()
        toast = getattr(self, 'menu_toast', None)
        if toast and pygame.time.get_ticks() - toast[1] < 2200:
            r = pygame.Rect(0, 0, 420, 44)
            r.center = (SCREEN_W // 2 + 180, SCREEN_H - 90)
            W.box(scr, r, 200)
            S.text(scr, toast[0], r.center, self.fonts['b'], (255, 236, 190), anchor='center')
        if s != 'setup':
            self.audio.draw_icon(scr, SCREEN_W - 58, 20)

    def draw_main(self):
        scr = self.screen
        # column: dark stone + a golden edge on the right
        col = S.tiled('skin/stone_dark.png', COL.size, tint=(170, 150, 128))
        scr.blit(col, COL.topleft)
        S.vignette(scr, COL, 120)
        pygame.draw.line(scr, (20, 12, 6), (COL.right, 0), (COL.right, SCREEN_H), 4)
        pygame.draw.line(scr, S.GOLD_DK, (COL.right - 3, 0), (COL.right - 3, SCREEN_H), 2)
        # title
        for i, part in enumerate(i18n.t('app.title').upper().split(' ', 1)):
            img = S.gold_text(part, self.fonts['xl'])
            scr.blit(img, img.get_rect(center=(COL.centerx, 50 + i * 48)))
        mp = pygame.mouse.get_pos()
        pressed = pygame.mouse.get_pressed()[0]
        modal = self.menu_screen != 'main'
        for r, act, lbl in self.main_rects():
            lbl = i18n.t(lbl)
            h = r.collidepoint(mp) and not modal
            if act in ('single', 'multi', 'learn'):
                art = menu_art.tile_art(act, (r.w, r.h - 30))
                scr.blit(art, r.topleft)
                strip = pygame.Rect(r.x, r.bottom - 30, r.w, 30)
                W.red_button(scr, strip, lbl, self.fonts['btn'] if act != 'multi' else self.fonts['l'],
                             'hover' if h else 'normal')
                pygame.draw.rect(scr, S.GOLD_HI if h else (120, 90, 50), r, 2)
                if act == 'multi':
                    S.shade_overlay(scr, r, (30, 24, 20), 110)
                    S.text(scr, i18n.t('menu.soon'), (r.right - 40, r.y + 18), self.fonts['bs'], (250, 230, 190),
                           anchor='center')
            elif act == 'credits':
                W.red_button(scr, r, lbl, self.fonts['bs'], 'hover' if h else 'normal')
            elif act in ('news', 'quit'):
                W.red_button(scr, r, lbl, self.fonts['btn'], 'pressed' if h and pressed else 'hover' if h else 'normal')
            elif act == 'settings':
                S.slot(scr, r, 'hover' if h else 'normal')
                S.blit_icon(scr, 'match-settings', r.center, 30)
                S.icon_frame(scr, r, 'hover' if h else 'normal')
            elif act == 'profile':
                W.red_button(scr, r, '', self.fonts['b'], 'hover' if h else 'normal')
                from . import civ_ui
                civ_ui.blit_emblem(self, self.cfg_defaults()['slots'][0]['civ'], (r.x + 4, r.y + 3, 30, 34))
                S.text_fit(scr, i18n.player_name(), (r.x + 42, r.y + 12), self.fonts['b'],
                           (255, 240, 205), anchor='midleft', shadow=(30, 8, 4), max_w=r.w - 50)
                S.text_fit(scr, i18n.t('menu.single_mode'), (r.x + 42, r.y + 29), self.fonts['s'], (230, 200, 170),
                           anchor='midleft', shadow=None, max_w=r.w - 50)
        # ornament above "News"
        y = 648
        pygame.draw.line(scr, S.GOLD_DK, (COL.centerx - 120, y), (COL.centerx + 120, y), 2)
        pts = [(COL.centerx, y - 8), (COL.centerx + 8, y), (COL.centerx, y + 8), (COL.centerx - 8, y)]
        pygame.draw.polygon(scr, S.GOLD, pts)
        # the news feed on the right (like DE's event feed)
        if self.menu_screen == 'main':
            self.draw_feed(pygame.Rect(SCREEN_W - 400, 70, 380, 330))
        # version at the bottom center
        S.text(scr, version_line(), ((COL.right + SCREEN_W) // 2, SCREEN_H - 34), self.fonts['bs'],
               (240, 226, 196), anchor='center')
        S.text_fit(scr, i18n.t('menu.credits_line'), ((COL.right + SCREEN_W) // 2, SCREEN_H - 16), self.fonts['s'],
                   (200, 188, 160), anchor='center', max_w=SCREEN_W - COL.right - 20)

    def draw_feed(self, box):
        scr = self.screen
        y = box.y
        for d, s in news()[:4]:
            hdr = pygame.Rect(box.x, y, box.w, 26)
            W.red_button(scr, hdr, d or i18n.t('menu.new'), self.fonts['bs'])
            lines = _wrap(self.fonts['m'], s, box.w - 20)
            if len(lines) > 2:
                lines = lines[:2]
                lines[1] = lines[1].rstrip(' ,.:;—') + '…'
            body = pygame.Rect(box.x, hdr.bottom, box.w, 8 + 18 * len(lines))
            S.shade_overlay(scr, body, (10, 6, 2), 170)
            for j, ln in enumerate(lines):
                S.text(scr, ln, (body.centerx, body.y + 13 + j * 18), self.fonts['m'], (240, 230, 206),
                       anchor='center')
            y = body.bottom + 8
            if y > box.bottom:
                break

    # ---- the "Single Player" window
    def draw_single(self):
        scr = self.screen
        S.shade_overlay(scr, (COL.right, 0, SCREEN_W - COL.right, SCREEN_H), alpha=120)
        b = SINGLE_BOX
        S.panel(scr, b, 'parchment', frame=False)
        pygame.draw.rect(scr, (120, 84, 40), b, 2)
        W.plate(scr, (b.centerx, b.y + 30), i18n.t('menu.single'), self.fonts['h'], 340)
        mp = pygame.mouse.get_pos()
        art_of = {'skirmish': 'skirmish', 'campaign': 'campaign', 'scenario': 'scenario', 'load_game': 'load'}
        for r, act, ok in self.single_rects():
            h = r.collidepoint(mp)
            if act == 'back':
                W.red_button(scr, r, i18n.t('common.cancel'), self.fonts['b'], 'hover' if h else 'normal')
                continue
            lbl = i18n.t(next(lb for a, lb, _ in SINGLE_TILES if a == act))
            art = menu_art.tile_art(art_of[act], (r.w, r.h - 34))
            scr.blit(art, r.topleft)
            W.red_button(scr, pygame.Rect(r.x, r.bottom - 34, r.w, 34), lbl, self.fonts['b'],
                         'disabled' if not ok else 'hover' if h else 'normal')
            pygame.draw.rect(scr, S.GOLD_HI if h and ok else (120, 84, 40), r, 2)
            if not ok:
                S.shade_overlay(scr, pygame.Rect(r.x, r.y, r.w, r.h - 34), (60, 50, 40), 90)
                S.text(scr, i18n.t('menu.soon'), (r.centerx, r.y + 22), self.fonts['b'], (255, 240, 210), anchor='center')

    # ---- tutorial
    def draw_learn(self):
        scr = self.screen
        S.shade_overlay(scr, (COL.right, 0, SCREEN_W - COL.right, SCREEN_H), alpha=150)
        box = pygame.Rect(COL.right + 30, 40, SCREEN_W - COL.right - 60, SCREEN_H - 140)
        S.panel(scr, box, 'parchment', frame=False)
        W.plate(scr, (box.centerx, box.y + 32), i18n.t('menu.learn_title'), self.fonts['h'], 380)
        cw, ch = (box.w - 60) // 3, 250
        for i, (ic, key, n) in enumerate(LEARN_CARDS):
            r = pygame.Rect(box.x + 20 + (i % 3) * (cw + 10), box.y + 70 + (i // 3) * (ch + 12), cw, ch)
            W.box(scr, r, 40)
            S.blit_icon(scr, ic, (r.centerx, r.y + 48), 64)
            S.text_fit(scr, i18n.t(f'learn.{key}.title'), (r.centerx, r.y + 100), self.fonts['l'], W.INK, anchor='center',
                       shadow=None, max_w=r.w - 20)
            y = r.y + 130
            for row in (i18n.t(f'learn.{key}.{j + 1}') for j in range(n)):
                for ln in _wrap(self.fonts['m'], row, r.w - 24):
                    S.text(scr, ln, (r.centerx, y), self.fonts['m'], W.INK, anchor='center', shadow=None)
                    y += 19
                y += 6
        mp = pygame.mouse.get_pos()
        for r, act, _ in self.learn_rects():
            W.red_button(scr, r, i18n.t('menu.tutorial') if act == 'tutorial' else i18n.t('common.back'), self.fonts['b'],
                         'hover' if r.collidepoint(mp) else 'normal', icon='call-to-arms' if act == 'tutorial' else None)

    # ---- news
    def draw_news(self):
        scr = self.screen
        S.shade_overlay(scr, (COL.right, 0, SCREEN_W - COL.right, SCREEN_H), alpha=150)
        box = pygame.Rect(COL.right + 60, 40, SCREEN_W - COL.right - 120, SCREEN_H - 130)
        S.panel(scr, box, 'parchment', frame=False)
        W.plate(scr, (box.centerx, box.y + 32), i18n.t('menu.news'), self.fonts['h'], 300)
        view = pygame.Rect(box.x + 30, box.y + 70, box.w - 60, box.h - 90)
        items = news()
        total = len(items) * 56
        self.news_scroll = max(0, min(max(0, total - view.h), self.news_scroll))
        clip = scr.get_clip()
        scr.set_clip(view)
        y = view.y - self.news_scroll
        for d, s in items:
            S.blit_icon(scr, 'upgrade', (view.x + 16, y + 20), 26)
            S.text(scr, d, (view.x + 40, y + 8), self.fonts['bs'], (140, 40, 20), shadow=None)
            lines = _wrap(self.fonts['m'], s, view.w - 60)[:2]
            for j, ln in enumerate(lines):
                S.text(scr, ln, (view.x + 40, y + 26 + j * 17), self.fonts['m'], W.INK, shadow=None)
            y += 56
        scr.set_clip(clip)
        mp = pygame.mouse.get_pos()
        for r, act, _ in self.menu_items():
            W.red_button(scr, r, i18n.t('common.back'), self.fonts['b'], 'hover' if r.collidepoint(mp) else 'normal')

    # ---- credits
    def credits_lines(self):
        """CREDITS.md -> [(style, text)]; styles: h1 h2 h3 p li q tr."""
        if self._credits is not None:
            return self._credits
        lines = []
        try:
            with open(os.path.join(ROOT, 'CREDITS.md'), encoding='utf-8') as f:
                raw = f.read().splitlines()
        except OSError:
            raw = ['# Credits', i18n.t('menu.credits_missing')]
        merged = []
        for ln in raw:
            st = ln.strip()
            plain = st and not st.startswith(('#', '- ', '* ', '|', '>'))
            if plain and merged and merged[-1].strip() and not merged[-1].lstrip().startswith(('#', '|')):
                merged[-1] = merged[-1].rstrip() + ' ' + st
            else:
                merged.append(ln)
        raw = merged
        wrap_w = 900
        for ln in raw:
            s = ln.rstrip()
            if not s.strip():
                lines.append(('gap', ''))
                continue
            style = 'p'
            if s.startswith('### '):
                style, s = 'h3', s[4:]
            elif s.startswith('## '):
                style, s = 'h2', s[3:]
            elif s.startswith('# '):
                style, s = 'h1', s[2:]
            elif s.lstrip().startswith(('- ', '* ')):
                style, s = 'li', s.lstrip()[2:]
            elif s.startswith('>'):
                style, s = 'q', s.lstrip('> ')
            elif s.startswith('|'):
                if set(s.replace('|', '').strip()) <= set('-: '):
                    continue
                style, s = 'tr', '  ·  '.join(c.strip() for c in s.strip('|').split('|'))
            s = re.sub(r'\*\*(.+?)\*\*', r'\1', s)
            s = re.sub(r'`(.+?)`', r'\1', s)
            s = re.sub(r'\[(.+?)\]\((.+?)\)', r'\1 (\2)', s)
            s = s.replace('<', '').replace('>', '')
            f = self.credits_font(style)
            words = s.split(' ')
            cur = ''
            first = True
            for wd in words:
                t = (cur + ' ' + wd).strip()
                if f.size(t)[0] > wrap_w - (24 if style == 'li' else 0) and cur:
                    lines.append((style if first else style + '+', cur))
                    first = False
                    cur = wd
                else:
                    cur = t
            lines.append((style if first else style + '+', cur))
        self._credits = lines
        return lines

    def credits_font(self, style):
        style = style.rstrip('+')
        return {'h1': self.fonts['h'], 'h2': self.fonts['l'], 'h3': self.fonts['btn']}.get(
            style, self.fonts['s'] if style == 'tr' else self.fonts['m'])

    def draw_credits(self):
        scr = self.screen
        box = pygame.Rect(SCREEN_W // 2 - 500, 40, 1000, SCREEN_H - 130)
        S.panel(scr, box, 'parchment', frame=False)
        view = box.inflate(-80, -60)
        lines = self.credits_lines()
        heights = []
        for style, s in lines:
            st = style.rstrip('+')
            heights.append({'gap': 8, 'h1': 40, 'h2': 32, 'h3': 28}.get(st, 19))
        total = sum(heights)
        self.credits_scroll = max(0, min(max(0, total - view.h), self.credits_scroll))
        clip = scr.get_clip()
        scr.set_clip(view)
        y = view.y - self.credits_scroll
        for (style, s), h in zip(lines, heights):
            if y + h >= view.y and y <= view.bottom:
                st = style.rstrip('+')
                f = self.credits_font(style)
                x = view.x
                col = S.INK
                if st in ('h1', 'h2'):
                    col = (110, 40, 20)
                elif st == 'h3':
                    col = (90, 50, 20)
                elif st == 'q':
                    col = (80, 60, 30)
                    x += 20
                    pygame.draw.line(scr, (150, 110, 60), (view.x + 6, y), (view.x + 6, y + h), 3)
                elif st == 'li':
                    x += 24
                    if not style.endswith('+'):
                        pygame.draw.circle(scr, (120, 70, 30), (view.x + 10, y + 9), 3)
                elif st == 'tr':
                    x += 12
                if st != 'gap':
                    S.text(scr, s, (x, y), f, col, shadow=None)
                if st in ('h1', 'h2') and not style.endswith('+'):
                    pygame.draw.line(scr, (150, 110, 60), (view.x, y + h - 6), (view.right, y + h - 6), 1)
            y += h
        scr.set_clip(clip)
        if total > view.h:
            track = pygame.Rect(box.right - 24, view.y, 8, view.h)
            pygame.draw.rect(scr, (150, 120, 80), track, border_radius=4)
            th = max(30, int(view.h * view.h / total))
            ty = view.y + int((view.h - th) * self.credits_scroll / max(1, total - view.h))
            pygame.draw.rect(scr, (100, 60, 24), (track.x, ty, 8, th), border_radius=4)
        mp = pygame.mouse.get_pos()
        for r, act, _ in self.menu_items():
            W.red_button(scr, r, i18n.t('common.back'), self.fonts['b'], 'hover' if r.collidepoint(mp) else 'normal')
