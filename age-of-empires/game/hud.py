"""The in-game interface (a mixin of ui.Game) in the AoE2 DE layout:

  top      - resources "wood · food · gold · stone" with the number of villagers on each, population, idle,
             the age (a progress bar during advancement), the coat of arms, 5 round buttons (objectives, chat, diplomacy,
             tech tree, menu); under it the control group icons and the global queue;
  bottom   - two panels with a window onto the world between them: the command panel (a 5x3 grid + the selection parchment)
             and the minimap panel (a diamond + 4 corner buttons), above it the player score (F4);
  tooltips - a dark plate at the left above the panel, with a delay.
Windows over the game - game/hud_windows.py. Graphics of the frame - game/uiskin.py.
"""
import pygame

from .data import (SCREEN_W, SCREEN_H, TOP_H, PANEL_H, TILE, GAME_SPEED, RES, RES_COLOR, AGE_NAMES,
                   NODE_DEFS, TECHS, UNITS, BUILDINGS, ANIMALS, FARM_RATE, AGE_TECHS, BUILD_MENU, HOTKEYS,
                   as_tuple, shade)
from .world import Unit, Building, Node, Animal
from . import civ_ui, hud_windows, i18n, uiskin as S
from . import themes

# ---------------------------------------------------------------- layout (1280x800)
PY0 = SCREEN_H - PANEL_H                               # top of the command panel
CMD_FULL = pygame.Rect(0, PY0, 833, PANEL_H)           # command panel (DE: 1125/1920 at a height of 1080)
CMD_SMALL = pygame.Rect(0, PY0, 262, PANEL_H)          # collapsed: the grid only
MAP_PANEL = pygame.Rect(SCREEN_W - 367, SCREEN_H - 181, 367, 181)
MM_RECT = pygame.Rect(MAP_PANEL.x + 29, MAP_PANEL.y + 13, 310, 155)   # minimap diamond 2 : 1
GRID_BOX = pygame.Rect(6, PY0 + 8, 240, PANEL_H - 14)
INFO_BOX = pygame.Rect(252, PY0 + 8, 550, PANEL_H - 14)
GRID_X, GRID_Y, GRID_STEP, BTN = 14, PY0 + 16, 45, 42
COLLAPSE_FULL = pygame.Rect(807, PY0 + 10, 20, 26)
COLLAPSE_SMALL = pygame.Rect(238, PY0 + 10, 20, 26)
INFO_X = INFO_BOX.x + 10
PORT = 56                 # large portrait (~ 1/3 of the panel height, as in DE)
TX = INFO_X + PORT + 16   # stats column
TOP_RES = ('wood', 'food', 'gold', 'stone')            # DE order
# DE: objectives - a scroll with a red tick, chat - a horn, diplomacy - a wreath with a handshake, tree - a gear, menu - a scroll
# captions of buttons, modes, jobs and help are locale keys (hud.*, job.*, bonus.*, help.*)
TOP_BTNS = [('objectives', 'hud.objectives', ('portraits/de/top_objectives.png', 'victory')),
            ('chat', 'hud.chat', ('portraits/de/top_chat.png',)),
            ('diplomacy', 'hud.diplomacy', ('portraits/de/top_diplomacy.png', 'diplomacy')),
            ('techtree', 'hud.techtree', ('portraits/de/top_techtree.png', 'upgrade')),
            ('menu', 'hud.menu', ('match-settings',))]
MM_BTNS = ['flare', 'score', 'colors', 'mode']         # ↖ ↗ ↙ ↘
MM_MODES = ['hud.mm.normal', 'hud.mm.military', 'hud.mm.economy']
TIP_DELAY = 350           # ms before a tooltip appears
TEAM_COLORS = {'me': (70, 130, 255), 'ally': (240, 215, 60), 'enemy': (225, 50, 40)}

# villager grid: two pages with fixed places (DE)
ECO_PAGE = {'house': 0, 'mill': 1, 'mining_camp': 2, 'lumber_camp': 3, 'dock': 4,
            'farm': 5, 'blacksmith': 6, 'market': 7, 'monastery': 8, 'university': 9,
            'town_center': 10, 'wonder': 11}
MIL_PAGE = {'barracks': 0, 'archery_range': 1, 'stable': 2, 'siege_workshop': 3,
            'outpost': 5, 'palisade_wall': 6, 'stone_wall': 7, 'tower': 8, 'bombard_tower': 9,
            'gate': 10, 'palisade_gate': 11, 'castle': 12}
# town center: villager Q, loom A, wheelbarrow S, town watch D, eject G, age Z, town bell B
TC_SLOTS = {'villager': 0, 'loom': 5, 'wheelbarrow': 6, 'hand_cart': 6, 'town_watch': 7, 'town_patrol': 7,
            'feudal': 10, 'castle': 10, 'imperial': 10}

X_ICONS = {'bell': 'bell_level2', 'clear': 'back-to-work', 'eject': 'garrison-out', 'shield': 'garrison',
           # DE trebuchet: packed / unpacked - a render of our model (tools/build_portraits.py --orders)
           'treb_pack': 'portraits/orders/treb_packed.png', 'treb_up': 'portraits/orders/treb_up.png'}
# DE: attack - a sword, armor - a cuirass, range - a target with an arrow, speed - a boot (tools/ui_icon_art.py)
STAT_ICONS = {'atk': 'portraits/de/stat_atk.png', 'arm': 'portraits/de/stat_arm.png',
              'rng': 'portraits/de/stat_rng.png', 'spd': 'portraits/de/stat_spd.png'}
STAT_ICONS_0AD = {'atk': 'portraits/technologies/sword_01.png', 'arm': 'portraits/technologies/armor_scale.png',
                  'rng': 'portraits/technologies/arrow_01.png', 'spd': 'portraits/technologies/walk.png'}
BONUS_NAMES = {k: 'bonus.' + k for k in ('cav', 'arch', 'bld', 'inf', 'spear', 'siege', 'monk', 'camel', 'ship')}
VIL_JOB = {k: 'job.' + k for k in ('wood', 'gold', 'stone', 'berries', 'farm', 'hunt', 'build', 'fish')}
ROMAN = ['I', 'II', 'III', 'IV']
# help: (keys, action); keys are letters as they are, words (LMB, Shift + placement...) are help.k<n> keys
HELP_ROWS = [
    ('help.k1', 'help.v1'),
    ('help.k2', 'help.v2'),
    ('Q W E R T · A S D F G · Z X C V B', 'help.v3'),
    ('help.k4', 'help.v4'),
    ('help.k5', 'help.v5'),
    ('help.k6', 'help.v6'),
    ('help.k7', 'help.v7'),
    ('Ctrl + 1…9 / 1…9', 'help.v8'),
    ('H', 'help.v9'),
    ('.', 'help.v10'),
    ('help.k11', 'help.v11'),
    ('help.k12', 'help.v12'),
    ('+ / −', 'help.v13'),
    ('P / F3', 'help.v14'),
    ('F4 · F11', 'help.v15'),
    ('F5 · Enter', 'help.v16'),
    ('Delete', 'help.v17'),
    ('help.k18', 'help.v18'),
    ('help.k19', 'help.v19'),
    ('F2 · F10', 'help.v20'),
]
GAME_MENU = [('resume', 'gm.continue', 'call-to-arms'), ('help', 'gm.help', 'encyclopaedia'),
             ('civ', 'gm.civ', 'diplomacy'), ('quit', 'menu.to_main', 'cancel')]


def _lum(c):
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]


class HudUI:
    idle_rect = None
    menu_btn_rect = None
    _cursor_t = 0
    ink = False               # True - text is drawn on parchment (Game.text darkens light colors)
    window = None             # open window: 'objectives' | 'chat' | 'diplomacy' | 'techtree'
    info_collapsed = False
    build_page = None         # villager building page: None | 'eco' | 'mil'
    show_score = True
    clock_mode = 1            # F11: 0 - hidden, 1 - time and speed, 2 - + frames per second
    mm_mode = 0               # MM_MODES
    mm_team = False           # team colors on the minimap
    show_history = False

    # ============================================================ state
    def hud_reset(self):
        """A new match: the default interface state."""
        self.window = None
        self.info_collapsed = False
        self.build_page = None
        self._bp_key = None
        self.chat_log = []             # (text, color)
        self.chat_text = ''
        self.chat_to = 'all'
        self.chat_replies = []         # (time in ms, text, color) - allies' replies
        self.show_history = False
        self.group_hits = []
        self.gq_hits = []
        self.top_btn_rects = []
        self.mm_btn_rects = []
        self._tip = (None, 0)
        self._score = (-1.0, {})
        self.tt_civ = None
        self.show_score = self.hud_opt('show_score', True)
        f = self.fonts
        f.setdefault('n', S.font('antiqua', 18, True))
        f.setdefault('age', S.font('antiqua', 18, True))
        f.setdefault('tip', S.font('antiqua', 13, True))
        f.setdefault('tipb', S.font('antiqua', 15, True))

    def hud_opt(self, name, default=None):
        """An interface setting: game.settings (the "Settings" menu), then the sound settings, otherwise the default."""
        for st in (getattr(self, 'settings', None), getattr(getattr(self, 'audio', None), 'settings', None)):
            if isinstance(st, dict) and name in st:
                return st[name]
        return default

    def cmd_rect(self):
        return CMD_SMALL if self.info_collapsed else CMD_FULL

    def hud_rects(self):
        """Interface rectangles covering the world (for clicks and the cursor)."""
        rs = [pygame.Rect(0, 0, SCREEN_W, TOP_H), civ_ui.top_emblem_rect(), self.cmd_rect(), MAP_PANEL]
        rs += [r for r, _ in self.group_hits] + [r for r, _ in self.gq_hits]
        if self.window:
            rs.append(hud_windows.box(self.window))
        return rs

    def hud_view(self, pos):
        """A point on the world (not under the panels)."""
        if not (TOP_H <= pos[1] < SCREEN_H and 0 <= pos[0] < SCREEN_W):
            return False
        return not any(r.collidepoint(pos) for r in self.hud_rects())

    # ============================================================ icons
    def owner_civ_key(self, owner):
        w = self.world
        if w is not None and 0 <= owner < len(w.players):
            return w.players[owner].civ
        return self.menu_cfg.get('civ', 'random')

    def skin_icon(self, typ, name, owner, size):
        """A 0 A.D. portrait/icon for Game.icon or None (then a procedural one)."""
        if typ == 'x':
            fn = X_ICONS.get(name)
            if fn is None:
                return None
            full = fn.startswith('portraits/')          # a picture filling the whole cell (DE)
            ic = S.icon(fn, size if full else int(size * 0.86))
            if ic is None:
                return None
            out = pygame.Surface((size, size), pygame.SRCALPHA)
            out.blit(ic, ic.get_rect(center=(size // 2, size // 2)))
            return out
        if typ not in ('u', 'b', 't', 'n'):
            return None
        civ = self.owner_civ_key(owner)
        up = None
        if typ == 't':
            t = TECHS.get(name, {})
            if t.get('upgrade'):
                up = t['upgrade'][1]
        return S.portrait(typ, name, civ, size, upgrade_of=up)

    def res_icon(self, r, cx, cy, s=7):
        size = 2 * s + 6
        if S.blit_icon(self.screen, r, (cx, cy), size):
            return
        scr = self.screen
        pygame.draw.circle(scr, RES_COLOR.get(r, (200, 200, 200)), (cx, cy), s)
        pygame.draw.circle(scr, (30, 24, 18), (cx, cy), s, 1)

    def pop_icon(self, cx, cy, size=20):
        if S.blit_icon(self.screen, 'pop', (cx, cy), size):
            return
        pygame.draw.circle(self.screen, (230, 210, 170), (cx, cy - 4), 3)
        pygame.draw.rect(self.screen, (230, 210, 170), (cx - 4, cy, 8, 7), border_radius=3)

    def stat(self, x, y, kind, val):
        """A stat icon + a number; returns x after the label."""
        ic = stat_icon(kind, 18)
        if ic is not None:
            r = ic.get_rect(midleft=(x, y))
            self.screen.blit(ic, r)
        r = self.text(val, (x + 24, y), 'b', anchor='midleft')
        return r.right + 16

    def age_shield(self, cx, cy, age, h=40, color=None, dim=False):
        """An age crest (DE: 4 different crests - round, kite-shaped, with a tower, quartered with a crown).
        dim - the age has not been reached yet (grey)."""
        scr = self.screen
        em = S.icon(f'portraits/de/age_{max(0, min(3, age))}.png', int(h * 1.12))
        if em is not None:
            if dim:
                em = pygame.transform.grayscale(em)
                em.fill((150, 150, 150), special_flags=pygame.BLEND_RGB_MULT)
            scr.blit(em, em.get_rect(center=(cx, cy)))
            return
        wdt = int(h * 0.8)
        x0, y0 = cx - wdt // 2, cy - h // 2
        pts = [(x0, y0), (x0 + wdt, y0), (x0 + wdt, y0 + h * 0.55), (cx, y0 + h), (x0, y0 + h * 0.55)]
        pygame.draw.polygon(scr, (20, 14, 8), [(px + 1, py + 2) for px, py in pts])
        pygame.draw.polygon(scr, color or (120, 32, 28), pts)
        half = [(cx, y0), (x0 + wdt, y0), (x0 + wdt, y0 + h * 0.55), (cx, y0 + h)]
        pygame.draw.polygon(scr, shade(color or (120, 32, 28), -35), half)
        pygame.draw.polygon(scr, S.GOLD, pts, 2)
        img = S.gold_text(ROMAN[max(0, min(3, age))], self.fonts['n'] if h < 34 else self.fonts['l'])
        scr.blit(img, img.get_rect(center=(cx, cy - h * 0.06)))

    # ============================================================ top panel
    def my_civ(self):
        w = getattr(self, 'world', None)
        return w.players[0].civ if w is not None and w.players else self.menu_cfg.get('civ', 'random')

    def top_bg(self):
        bg = getattr(self, '_top_bg', None)
        civ = self.my_civ()
        if bg is not None and getattr(self, '_top_bg_civ', None) != civ:
            bg = None
        if bg is None:
            self._top_bg_civ = civ
            bg = pygame.Surface((SCREEN_W, TOP_H + 6), pygame.SRCALPHA)
            bg.blit(S.culture_panel((SCREEN_W, TOP_H), civ), (0, 0))
            S.bevel(bg, (0, 0, SCREEN_W, TOP_H), width=2)
            # the resource block and the button block are embossed, with a narrow bar between them
            for r in (pygame.Rect(2, 2, 772, TOP_H - 4), pygame.Rect(1038, 2, SCREEN_W - 1040, TOP_H - 4)):
                S.bevel(bg, r, width=2)
                pygame.draw.rect(bg, (30, 20, 10), r, 1)
            plank = pygame.Rect(776, 10, 260, TOP_H - 20)
            s = pygame.Surface(plank.size, pygame.SRCALPHA)
            s.fill((0, 0, 0, 80))
            bg.blit(s, plank.topleft)
            pygame.draw.line(bg, (14, 10, 6), (0, TOP_H - 1), (SCREEN_W, TOP_H - 1), 1)
            S.trim_band(bg, (0, TOP_H - 6, SCREEN_W, 6), civ)          # culture border ornament
            for i in range(6):     # soft shadow on the map
                pygame.draw.line(bg, (0, 0, 0, 90 - i * 15), (0, TOP_H + i), (SCREEN_W, TOP_H + i))
            self._top_bg = bg
        return bg

    def icon_box(self, r):
        """A dark square cell under a resource icon (as in DE)."""
        pygame.draw.rect(self.screen, (12, 9, 6), r.inflate(2, 2))
        pygame.draw.rect(self.screen, (40, 32, 24), r)
        pygame.draw.rect(self.screen, (120, 98, 64), r, 1)

    def vil_jobs(self):
        """The player's villagers by job: {'wood'|'food'|'gold'|'stone'|'build'|'idle': n}."""
        w = self.world
        cnt = dict.fromkeys(('wood', 'food', 'gold', 'stone', 'build', 'idle'), 0)
        for u in w.units:
            if u.owner != 0 or u.cls != 'vil':
                continue
            t = u.target
            if u.state == 'gather' and t is not None:
                r = 'food' if isinstance(t, (Building, Animal)) else getattr(t, 'res', 'food')
            elif u.state == 'return' and u.carry_res:
                r = u.carry_res
            elif u.state == 'build':
                r = 'build'
            elif u.state == 'idle':
                r = 'idle'
            else:
                r = None
            if r in cnt:
                cnt[r] += 1
        return cnt

    def age_progress(self, p):
        """(next age, share) during advancement or None."""
        for b in self.world.buildings:
            if b.owner == p.id and b.queue and b.queue[0][0] == 'tech' and b.queue[0][1] in AGE_TECHS:
                name = b.queue[0][1]
                return name, max(0.0, min(1.0, b.qt / max(0.01, p.time_of('tech', name))))
        return None

    def draw_top(self):
        scr = self.screen
        w = self.world
        p = w.players[0]
        self.hud_tick()
        scr.blit(self.top_bg(), (0, 0))
        mp = pygame.mouse.get_pos()
        cy = TOP_H // 2
        jobs = self.vil_jobs()
        x = 6
        for r in TOP_RES:
            ib = pygame.Rect(x + 2, 5, 38, 38)
            self.icon_box(ib)
            S.blit_icon(scr, r, ib.center, 32) or self.res_icon(r, ib.centerx, ib.centery, 12)
            self.text(str(jobs[r]), (ib.right - 2, ib.bottom), 'bs', (255, 255, 255), anchor='bottomright')
            self.text(str(int(p.res[r])), (ib.right + 8, cy), 'b', anchor='midleft')
            x += 89
        # population: an icon + the total number of villagers, "pop/cap" (blinks when capped and waiting for houses)
        ib = pygame.Rect(x + 2, 5, 38, 38)
        self.icon_box(ib)
        self.pop_icon(ib.centerx, ib.centery, 32)
        nvil = sum(1 for u in w.units if u.owner == 0 and u.cls == 'vil')
        self.text(str(nvil), (ib.right - 2, ib.bottom), 'bs', (255, 255, 255), anchor='bottomright')
        housed = p.pop >= p.cap and any(b.owner == 0 and b.housed for b in w.buildings if b.queue)
        flash = housed and (pygame.time.get_ticks() // 400) % 2
        popc = S.RED if p.pop >= p.cap else S.TEXT
        pr = self.text(f'{p.pop}/{p.cap}', (ib.right + 8, cy), 'b', popc, anchor='midleft')
        if flash:
            pygame.draw.rect(scr, (230, 70, 40), pr.inflate(8, 6), 2, border_radius=3)
        x += 104
        # idle villagers - a yellow circle right after the population
        idle = jobs['idle']
        c = (x + 20, cy)
        self.idle_rect = pygame.Rect(c[0] - 19, c[1] - 19, 38, 38)
        pygame.draw.circle(scr, (20, 14, 8), (c[0] + 1, c[1] + 2), 18)
        pygame.draw.circle(scr, (228, 184, 36) if idle else (130, 110, 60), c, 18)
        pygame.draw.circle(scr, (255, 232, 140), c, 18, 2)
        idle_figure(scr, c)
        if idle:
            self.text(str(idle), (c[0] + 18, c[1] + 18), 'bs', (255, 255, 255), anchor='bottomright')
        if self.idle_rect.collidepoint(mp):
            pygame.draw.circle(scr, S.GOLD_HI, c, 20, 2)
        x += 44
        # age: a shield with a numeral + a bar with the name; during advancement - a progress bar
        self.age_shield(x + 24, cy, p.age, 40, shade(p.color, -60))
        bar = pygame.Rect(x + 50, 8, 772 - x - 56, TOP_H - 16)
        pygame.draw.rect(scr, (18, 13, 8), bar)
        prog = self.age_progress(p)
        if prog:
            name, fr = prog
            pygame.draw.rect(scr, (60, 110, 40), (bar.x + 1, bar.y + 1, int((bar.w - 2) * fr), bar.h - 2))
            pygame.draw.line(scr, (130, 190, 90), (bar.x + 1, bar.y + 2), (bar.x + int((bar.w - 2) * fr), bar.y + 2))
            label = f'{TECHS[name]["name"]} · {int(fr * 100)}%'
        else:
            label = AGE_NAMES[p.age]
        pygame.draw.rect(scr, (110, 88, 56), bar, 1)
        img = S.gold_text(label, self.fonts['age'])
        scr.blit(img, img.get_rect(center=bar.center))
        # bar: sound and music
        self.audio.draw_icon(scr, 790, cy - 10)
        # the civilization's coat of arms - a banner before the buttons
        civ_ui.draw_top(self)
        # 5 round buttons
        self.top_btn_rects = []
        for i, (act, _, ic) in enumerate(TOP_BTNS):
            bc = (1062 + i * 46, cy)
            r = pygame.Rect(bc[0] - 19, bc[1] - 19, 38, 38)
            self.top_btn_rects.append((r, act))
            on = self.window == act or (act == 'menu' and self.help == 'menu')
            h = r.collidepoint(mp)
            pygame.draw.circle(scr, (14, 10, 6), (bc[0] + 1, bc[1] + 2), 19)
            pygame.draw.circle(scr, (58, 44, 30) if not h else (84, 64, 40), bc, 18)
            pygame.draw.circle(scr, S.GOLD_HI if on or h else (150, 118, 70), bc, 18, 2)
            if not any(S.blit_icon(scr, c, bc, 28 if c.startswith('portraits/') else 24) for c in ic):
                chat_icon(scr, bc)
        self.menu_btn_rect = self.top_btn_rects[-1][0]
        # below the top: group icons, the global queue, the clock
        self.draw_groups()
        self.draw_global_queue()
        self.draw_clock()

    def draw_clock(self):
        if not self.clock_mode:
            return
        t = int(self.world.time)
        spc = (255, 220, 120) if self.speed != GAME_SPEED else (225, 215, 190)
        s = f'{t // 3600}:{t // 60 % 60:02d}:{t % 60:02d}  ×{self.speed:g}'
        if self.clock_mode == 2:
            s += '  ' + i18n.t('hud.fps', n=int(self.clock.get_fps()))
        img = self.fonts['bs'].render(s, True, spc)
        r = img.get_rect(topright=(SCREEN_W - 8, TOP_H + 26))
        S.shade_overlay(self.screen, r.inflate(10, 4), alpha=110)
        self.screen.blit(img, r)

    def draw_groups(self):
        """Control group icons 1...9, 0 under the resources: a number + the portrait of the most frequent kind + a count."""
        self.group_hits = []
        groups = getattr(self, 'groups', {}) or {}
        x = 6
        for n in list(range(1, 10)) + [0]:
            g = [u for u in groups.get(n, []) if u.alive]
            if not g:
                continue
            kinds = {}
            for u in g:
                kinds[u.kind] = kinds.get(u.kind, 0) + 1
            k = max(kinds, key=kinds.get)
            r = pygame.Rect(x, TOP_H + 4, 34, 34)
            ic = self.icon('u' if isinstance(g[0], Unit) else 'b', k, 0, 34)
            self.screen.blit(ic, r)
            S.icon_frame(self.screen, r, 'hover' if r.collidepoint(pygame.mouse.get_pos()) else 'normal')
            self.text(str(n), (r.x + 3, r.y + 1), 'bs', (120, 255, 120))
            if len(g) > 1:
                self.text(str(len(g)), (r.right - 2, r.bottom), 's', (255, 255, 255), anchor='bottomright')
            self.group_hits.append((r, n))
            x += 38

    def draw_global_queue(self):
        """Global queue (DE: "Global Queue"): what is being trained/researched right now in all buildings."""
        self.gq_hits = []
        if not self.hud_opt('global_queue', True):
            return
        w = self.world
        p = w.players[0]
        x = 6 + 38 * len(self.group_hits) + (14 if self.group_hits else 0)
        for b in w.buildings:
            if b.owner != 0 or not b.queue:
                continue
            kind, nm = b.queue[0]
            r = pygame.Rect(x, TOP_H + 4, 30, 30)
            ic = self.icon('u' if kind == 'unit' else 't', nm, 0, 30)
            self.screen.blit(ic, r)
            S.icon_frame(self.screen, r, 'hover' if r.collidepoint(pygame.mouse.get_pos()) else 'normal')
            fr = b.qt / max(0.01, p.time_of(kind, nm))
            pygame.draw.rect(self.screen, (14, 10, 8), (r.x, r.bottom + 1, r.w, 5))
            pygame.draw.rect(self.screen, (236, 200, 90), (r.x + 1, r.bottom + 2, int((r.w - 2) * min(1, fr)), 3))
            if len(b.queue) > 1:
                self.text(str(len(b.queue)), (r.right - 1, r.bottom - 1), 's', (255, 255, 255),
                          anchor='bottomright')
            self.gq_hits.append((r, b))
            x += 33
            if x > 740:
                break

    # ============================================================ clicks and keys
    def hud_top_click(self, pos):
        """Left click on the top panel: idle villager, coat of arms, round buttons."""
        if self.idle_rect and self.idle_rect.collidepoint(pos):
            self.select_idle()
            return
        if civ_ui.top_emblem_rect().collidepoint(pos):
            self.help = False if self.help == 'civ' else 'civ'
            return
        for r, act in self.top_btn_rects:
            if r.collidepoint(pos):
                self.audio.click()
                if act == 'menu':
                    self.window = None
                    self.help = False if self.help == 'menu' else 'menu'
                else:
                    self.toggle_window(act)
                return

    def toggle_window(self, name):
        self.window = None if self.window == name else name
        if name == 'techtree' and self.window:
            self.tt_civ = None

    def hud_click(self, pos):
        """Left click: True if the click was taken by the interface (the world does not get it)."""
        if self.window:
            if hud_windows.box(self.window).collidepoint(pos):
                hud_windows.click(self, self.window, pos)
            elif pos[1] < TOP_H:
                self.hud_top_click(pos)
            else:
                self.window = None
            return True
        if pos[1] < TOP_H or civ_ui.top_emblem_rect().collidepoint(pos):
            self.hud_top_click(pos)
            return True
        for r, n in self.group_hits:
            if r.collidepoint(pos):
                g = [u for u in self.groups.get(n, []) if u.alive]
                if g:
                    if self.selected == g:
                        self.center_on(*g[0].center())
                    self.selected = g
                return True
        for r, b in self.gq_hits:
            if r.collidepoint(pos):
                if b.alive:
                    if self.selected == [b]:
                        self.center_on(*b.center())
                    self.selected = [b]
                return True
        if MAP_PANEL.collidepoint(pos):
            for r, act in self.mm_btn_rects:
                if (pygame.Vector2(pos) - r.center).length() <= r.w / 2 + 1:
                    self.minimap_button(act)
                    return True
            if self.mm_hit(pos):
                if self.order_mode or self.mods() & pygame.KMOD_ALT:
                    if not self.order_mode:
                        self.order_mode = 'flare'           # Alt+left click on the minimap - a signal to allies
                    self.order_click(pos, mm=True)          # controls.py: an order / signal via the minimap
                    return True
                self.mm_drag = True
                self.minimap_jump(pos)
            return True
        cr = self.cmd_rect()
        if cr.collidepoint(pos):
            col = COLLAPSE_SMALL if self.info_collapsed else COLLAPSE_FULL
            if col.collidepoint(pos):
                self.info_collapsed = not self.info_collapsed
                self._panel_bg = None
                self.audio.click()
                return True
            for bt in self.get_buttons():
                if bt['rect'].collidepoint(pos):
                    self.press_button(bt)
                    return True
            for r, act in self.panel_hits:
                if r.collidepoint(pos):
                    self.panel_hit(act)
                    return True
            return True
        return False

    def panel_hit(self, act):
        w = self.world
        p = w.players[0]
        shift = self.mods() & pygame.KMOD_SHIFT
        if act[0] == 'cancel':
            b, idx = act[1], act[2]
            for i in sorted(idx, reverse=True)[:1 if not shift else len(idx)]:
                if b.alive and i < len(b.queue):
                    kind, name = b.queue.pop(i)
                    p.refund(p.cost_of(kind, name))
                    if kind == 'tech':
                        p.researching.discard(name)
                    if i == 0:
                        b.qt = 0
        elif act[0] == 'ungarrison':
            from . import defense
            defense.eject(w, act[1], [act[2]])
        elif act[0] == 'sel':
            self.panel_select(act[1])           # controls.py: Ctrl - remove, Shift - only the kind, Ctrl+Shift - remove the kind
        elif act[0] == 'stack':
            ents = act[1]
            ctrl = self.mods() & (pygame.KMOD_CTRL | pygame.KMOD_META)
            if ctrl and not shift:
                self.panel_select(ents[-1])     # Ctrl - remove one from the stack
            elif ctrl or shift:
                self.panel_select(ents[0].kind)
            else:
                self.selected = list(ents)      # a click on a stack - all of that kind

    def hud_rclick(self, pos):
        """Right click: True if the click was taken by the interface."""
        if self.window:
            self.window = None
            return True
        if MAP_PANEL.collidepoint(pos):
            if self.mm_hit(pos):
                self.command(*self.mm_to_world(pos), None)
            return True
        return not self.hud_view(pos)

    def hud_key(self, e):
        """Interface keys (before the regular ones): chat, F4, F5, F11, PgUp. True - the key was taken."""
        k = e.key
        if self.window == 'chat':
            return hud_windows.chat_key(self, e)
        if self.window and k == pygame.K_ESCAPE:
            self.window = None
            return True
        if k == pygame.K_F4:
            self.show_score = not self.show_score
            return True
        if k == pygame.K_F11:
            self.clock_mode = (self.clock_mode + 1) % 3
            return True
        if k == pygame.K_F5:
            self.toggle_window('techtree')
            return True
        if k in (pygame.K_RETURN, pygame.K_KP_ENTER) and not self.help:
            self.window = 'chat'
            return True
        if k in (pygame.K_PAGEUP, pygame.K_PAGEDOWN):
            self.show_history = k == pygame.K_PAGEUP
            return True
        return False

    def hud_tick(self):
        """Once per frame: allies' replies in chat (and to a signal - the 'flare' event from controls.py)."""
        now = pygame.time.get_ticks()
        w = self.world
        for ev in getattr(self, 'events', ()):
            if ev[0] == 'flare' and ev[3] == 0:
                allies = [q for q in w.players[1:] if q.alive and w.allied(0, q.id) and q.is_ai]
                for i, q in enumerate(allies):
                    self.chat_replies.append((now + 900 + i * 600,
                                              f'{q.name}: {i18n.t(hud_windows.FLARE_REPLY[q.id % 3])}',
                                              shade(q.color, 60)))
        due = [r for r in self.chat_replies if r[0] <= now]
        if due:
            self.chat_replies = [r for r in self.chat_replies if r[0] > now]
            for _, txt, col in due:
                self.chat_log.append((txt, col))
                self.world.msg(txt, col)

    # ============================================================ bottom panel
    def panel_bg(self):
        bg = getattr(self, '_panel_bg', None)
        civ = self.my_civ()
        if bg is not None and getattr(self, '_panel_bg_civ', None) == civ:
            return bg
        self._panel_bg_civ = civ
        cul = S.culture(civ)
        metal = cul['metal']
        bg = pygame.Surface((SCREEN_W, SCREEN_H - MAP_PANEL.y + 8), pygame.SRCALPHA)
        oy = MAP_PANEL.y - 8                    # screen y of the top of the surface
        cmd = self.cmd_rect().move(0, -oy)
        mp_ = MAP_PANEL.move(0, -oy)
        for body in (cmd, mp_):
            for i in range(8):                  # shadow above the panel
                pygame.draw.line(bg, (0, 0, 0, 20 + i * 12), (body.x, body.y - 8 + i), (body.right, body.y - 8 + i))
            bg.blit(S.culture_panel(body.size, civ), body.topleft)
            S.bevel(bg, body, width=3)
            pygame.draw.rect(bg, (12, 8, 4), body, 2)
            S.trim_band(bg, (body.x + 2, body.y + 2, body.w - 4, 6), civ)
        # the grid - dark stone, the selection - plain parchment with a pale coat of arms (DE)
        gb = GRID_BOX.move(0, -oy)
        bg.blit(S.tiled('skin/stone_dark.png', gb.size, tint=cul['grid_tint']), gb.topleft)
        S.vignette(bg, gb, 140)
        S.gold_frame(bg, gb, color=metal)
        S.corners(bg, gb, 6)
        if not self.info_collapsed:
            ib = INFO_BOX.move(0, -oy)
            bg.blit(S.parchment_flat(ib.size, civ_ui.emblem(civ, 110, 130)), ib.topleft)
            pygame.draw.rect(bg, (60, 40, 20), ib, 2)
            S.gold_frame(bg, ib.inflate(4, 4), color=metal)
            S.corners(bg, ib.inflate(4, 4), 6)
        # minimap: parchment in the corners, a dark diamond in a thick border
        mr = MM_RECT.move(0, -oy)
        inner = mp_.inflate(-12, -12)
        bg.blit(S.parchment_flat(inner.size), inner.topleft)
        S.gold_frame(bg, inner, color=metal)
        for grow, col in ((10, (16, 11, 6)), (7, (120, 86, 36)), (5, (240, 206, 130)), (3, (90, 62, 24)),
                          (1, (10, 8, 6))):
            pts = [(mr.centerx, mr.top - grow), (mr.right + grow * 2, mr.centery), (mr.centerx, mr.bottom + grow),
                   (mr.left - grow * 2, mr.centery)]
            pygame.draw.polygon(bg, col, pts)
        self._panel_bg = bg
        return bg

    def draw_panel(self):
        scr = self.screen
        scr.blit(self.panel_bg(), (0, MAP_PANEL.y - 8))
        self.draw_minimap()
        self.draw_score()
        self.panel_hits = []
        mp = pygame.mouse.get_pos()
        col = COLLAPSE_SMALL if self.info_collapsed else COLLAPSE_FULL
        S.slot(scr, col, 'hover' if col.collidepoint(mp) else 'normal')
        d = 1 if self.info_collapsed else -1
        cx, cy = col.center
        pygame.draw.polygon(scr, S.GOLD, [(cx - 4 * d, cy - 6), (cx + 4 * d, cy), (cx - 4 * d, cy + 6)])
        if not self.info_collapsed:
            self.ink = True
            try:
                self.draw_selection_info()
            finally:
                self.ink = False
        pressed = pygame.mouse.get_pressed()[0]
        hover = None
        for bt in self.get_buttons():
            r = bt['rect']
            h = r.collidepoint(mp)
            state = self.btn_state(bt) if not bt['ok'] else ('pressed' if h and pressed else 'hover' if h else 'normal')
            self.draw_cmd_button(bt, r, state)
            if h:
                hover = bt
        now = pygame.time.get_ticks()
        key = (hover['key'], hover['tip'][0]) if hover else None
        if key != self._tip[0]:
            self._tip = (key, now)
        if hover and now - self._tip[1] >= TIP_DELAY:
            self.draw_tooltip(hover)

    def btn_state(self, bt):
        """An unavailable button (DE): 'poor' - only resources are missing (the icon is red), otherwise 'disabled' (grey)."""
        tip = bt.get('tip') or ()
        if any(isinstance(x, tuple) and x[0] == 'red' for x in tip[2:]):
            return 'disabled'
        cost = tip[1] if len(tip) > 1 and isinstance(tip[1], dict) else None
        if cost and not self.world.players[0].afford(cost):
            return 'poor'
        return 'disabled'

    def draw_cmd_button(self, bt, r, state):
        scr = self.screen
        typ, name = bt['icon']
        if typ in ('draw',):
            S.slot(scr, r, 'hover' if state == 'hover' else 'normal')
        else:
            pygame.draw.rect(scr, (0, 0, 0), r)          # DE: an icon filling the whole cell on black
        inner = r.inflate(-2, -2)
        if typ == 'stop':
            S.blit_icon(scr, 'stop', r.center, 34) or pygame.draw.rect(scr, (200, 60, 50), r.inflate(-18, -18))
        elif typ == 'draw':
            name(self, r, bt['ok'])     # the button draws itself (market, reseeding)
        elif typ == 'unload':
            S.blit_icon(scr, 'garrison-out', r.center, 32)
            self.text(str(name), (r.x + 4, r.y + 2), 'bs', (255, 240, 200))
        elif typ == 'page':
            page, pages = name
            next_arrow(scr, r)
            for i in range(pages):
                pygame.draw.circle(scr, (255, 230, 150) if i == page else (110, 95, 70),
                                   (r.centerx - (pages - 1) * 4 + i * 8, r.bottom - 6), 2)
        elif typ == 'next':
            next_arrow(scr, r)
        elif typ == 'back':
            back_cross(scr, r)
        elif typ == 'bpage':
            ic = S.icon(f'portraits/de/build_{name[0]}.png', inner.w)     # DE: a hammer + coins / a hammer + a sword
            if ic is not None:
                scr.blit(ic, ic.get_rect(center=r.center))
            else:
                ic = self.icon('b', name[1], 0, inner.w)
                scr.blit(ic, ic.get_rect(center=r.center))
                hammer(scr, r.right - 12, r.y + 11, (240, 220, 160) if name[0] == 'eco' else (240, 150, 120))
        else:
            ic = self.icon(typ, name, 0, inner.w)
            scr.blit(ic, ic.get_rect(center=r.center))
        S.icon_frame(scr, inner if typ not in ('draw',) else r.inflate(-2, -2), state)
        if self.hud_opt('show_hotkeys', False):
            self.text(bt['key'], (r.right - 3, r.bottom), 's', (255, 230, 150), anchor='bottomright')

    # ---- tooltip: a dark plate at the left above the panel (DE)
    def tip_stats(self, bt):
        """A row of numbers under the description: [(icon, text)] for a unit / building."""
        act = bt.get('act') or ()
        p = self.world.players[0]
        kind = None
        if act and act[0] == 'train':
            kind, cat = p.current(act[2]), 'u'
        elif act and act[0] == 'place':
            kind, cat = act[1], 'b'
        else:
            return []
        d = (UNITS if cat == 'u' else BUILDINGS).get(kind)
        if not d:
            return []
        out = [('hp', str(int(p.stat('hp', kind, d.get('hp', 0)))))]
        if d.get('atk'):
            out.append(('atk', f'{p.stat("atk", kind, d["atk"]):g}'))
        arm = d.get('arm', (0, 0) if cat == 'u' else None)
        if arm:
            out.append(('arm', f'{p.stat("arm_m", kind, arm[0]):g}/{p.stat("arm_p", kind, arm[1]):g}'))
        if d.get('rng'):
            out.append(('rng', f'{p.stat("rng", kind, d["rng"]):g}'))
        return out

    def draw_tooltip(self, bt):
        self.draw_tip(bt['tip'], bt.get('key'), self.tip_stats(bt))

    def draw_tip(self, tip, key=None, stats=(), anchor=None):
        """tip = [name, cost, description, extra lines...]. anchor - (x, bottom) of the plate; by default at the left above the panel."""
        scr = self.screen
        name, cost = tip[0], tip[1] or {}
        k = max(50, min(100, int(self.hud_opt('tooltip_scale', 100) or 100))) / 100
        f, fb = S.font('antiqua', max(9, round(13 * k)), True), S.font('antiqua', max(10, round(15 * k)), True)
        maxw = int(440 * k)
        lines = []                                          # (text, color, font)
        for ex in tip[2:]:
            if isinstance(ex, tuple):
                col = (255, 120, 100) if ex[0] == 'red' else (200, 190, 165)
                lines += [(s, col, f) for s in wrap(ex[1], f, maxw)]
            else:
                lines += [(s, (240, 235, 220), f) for s in wrap(ex, f, maxw)]
        title_w = fb.size(name)[0]
        cost_items = [(r, cost[r]) for r in RES if cost.get(r)]
        cw = sum(f.size(str(v))[0] + 26 for _, v in cost_items)
        wdt = min(maxw, max([title_w + cw + 30] + [f.size(s)[0] for s, _, _ in lines])) + 20
        hgt = 26 + len(lines) * 18 + (24 if stats else 0) + (18 if key else 0) + 6
        if anchor is None:
            x, bottom = 4, self.cmd_rect().y - 6
        else:
            x, bottom = anchor
        x = max(2, min(SCREEN_W - wdt - 2, x))
        y = max(TOP_H + 2, bottom - hgt)
        box = pygame.Rect(x, y, wdt, hgt)
        S.shade_overlay(scr, box, alpha=200)            # DE: a black translucent plate without a frame
        yy = y + 6
        r = S.text(scr, name, (x + 10, yy), fb, (255, 240, 200))
        cx = r.right + 10
        p = self.world.players[0]
        for rk, v in cost_items:
            S.blit_icon(scr, rk, (cx + 9, yy + 9), 18) or self.res_icon(rk, cx + 9, yy + 9)
            ok = p.res[rk] >= v
            img = S.text(scr, str(v), (cx + 20, yy + 9), f, (240, 235, 220) if ok else (255, 110, 90), anchor='midleft')
            cx = img.right + 8
        yy += 22
        for s, col, ft in lines:
            S.text(scr, s, (x + 10, yy), ft, col)
            yy += 18
        if stats:
            sx = x + 10
            for kind, val in stats:
                if kind == 'hp':
                    hp_glyph(scr, sx, yy + 10)
                else:
                    ic = stat_icon(kind, 16)
                    if ic is not None:
                        scr.blit(ic, ic.get_rect(midleft=(sx, yy + 10)))
                r2 = S.text(scr, val, (sx + 19, yy + 10), f, (240, 235, 220), anchor='midleft')
                sx = r2.right + 12
            yy += 24
        if key:
            S.text(scr, i18n.t('hud.hotkey', key=key), (x + 10, yy), f, (200, 190, 165))

    # ---- selection (on parchment)
    def big_portrait(self, ic, hp_frac=None, owner=0):
        scr = self.screen
        box = pygame.Rect(INFO_X, INFO_BOX.y + 30, PORT, PORT)
        pygame.draw.rect(scr, (10, 7, 4), box.inflate(4, 4))
        if ic.get_size() != box.size:
            ic2 = pygame.Surface(box.size, pygame.SRCALPHA)
            ic2.blit(S.tiled('skin/stone_dark.png', box.size, tint=(120, 110, 100)), (0, 0))
            ic2.blit(ic, ic.get_rect(center=(PORT // 2, PORT // 2)))
            ic = ic2
        scr.blit(ic, box.topleft)
        pygame.draw.rect(scr, (40, 26, 12), box.inflate(4, 4), 2)
        if hp_frac is not None:
            hb = pygame.Rect(box.x - 2, box.bottom + 4, PORT + 4, 8)
            pygame.draw.rect(scr, (14, 10, 8), hb)
            c = self.pcolor(owner) if owner >= 0 else (200, 60, 50)
            fw = int((hb.w - 2) * max(0.0, min(1.0, hp_frac)))
            pygame.draw.rect(scr, c, (hb.x + 1, hb.y + 1, fw, hb.h - 2))
            pygame.draw.line(scr, shade(c, 60), (hb.x + 1, hb.y + 1), (hb.x + fw, hb.y + 1))
        return box

    def name_line(self, name):
        S.text(self.screen, name, (INFO_X + 2, INFO_BOX.y + 7), self.fonts['n'], S.INK, shadow=None)

    def hp_text(self, e):
        self.text(f'{int(max(0, e.hp))}/{int(e.max_hp)}', (INFO_X, INFO_BOX.y + 30 + PORT + 16), 'bs')

    def owner_label(self, owner, x=None, y=None):
        """'Name (Civilization)' in the player's color at the top right, below it - 'Enemy' / 'Ally' (DE)."""
        w = self.world
        pl = w.players[owner]
        right = INFO_BOX.right - 22
        y0 = INFO_BOX.y + 12
        img = S.text(self.screen, f'{pl.name} ({civ_ui.civ_name(pl.civ)})', (right, y0), self.fonts['bs'],
                     shade(pl.color, -50) if _lum(pl.color) > 150 else pl.color, anchor='topright', shadow=None)
        civ_ui.blit_emblem(self, pl.civ, (img.x - 18, y0 - 1, 14, 17))
        rel = self.relation(owner)
        if rel in ('ally', 'enemy'):
            S.text(self.screen, i18n.t('rel.' + rel), (right, y0 + 18), self.fonts['bs'],
                   (40, 110, 40) if rel == 'ally' else (170, 30, 20), anchor='topright', shadow=None)

    def stat_row(self, x, y, kind, val):
        """A row of the stats column: an 18 px icon + a number."""
        if kind == 'hp':
            pass                                     # DE: health has no icon - only numbers
        elif kind in STAT_ICONS:
            ic = stat_icon(kind, 18)
            if ic is not None:
                self.screen.blit(ic, ic.get_rect(midleft=(x, y)))
        elif kind in RES or kind in ('pop', 'time'):
            S.blit_icon(self.screen, kind, (x + 9, y), 18)
        elif kind == 'work':
            hammer(self.screen, x + 9, y, (90, 70, 50))
        self.text(val, (x + 26, y), 'b', anchor='midleft')

    def draw_selection_info(self):
        scr = self.screen
        w = self.world
        sel = [e for e in self.selected if e.alive]
        if not sel:
            self.draw_nothing()
            return
        if len(sel) > 1:
            self.draw_stacks(sel)
            return
        e = sel[0]
        y0 = INFO_BOX.y + 30
        rows = []                                       # (icon, text) - the column from top to bottom
        if isinstance(e, Animal):
            self.name_line(e.d['name'] + (' ' + i18n.t('hud.carcass') if e.dead else ''))
            self.big_portrait(self.icon('u', e.kind, 0, PORT), None if e.dead else e.hp / e.max_hp, e.owner)
            if e.owner >= 0:
                self.owner_label(e.owner)
            if not e.dead:
                self.hp_text(e)
            rows.append(('food', str(int(e.amount))))
            self.stat_col(rows, y0)
            return
        if isinstance(e, Node):
            self.name_line(NODE_DEFS[e.kind]['name'])
            self.big_portrait(self.icon('n', e.kind, 0, PORT))
            self.stat_col([(e.res, str(int(e.amount)))], y0)
            return
        is_u = isinstance(e, Unit)
        name = e.d['name']
        if is_u and e.cls == 'vil' and e.owner == 0:
            job = self.vil_job(e)
            if job:
                name = i18n.t(VIL_JOB[job]) if job in VIL_JOB else name
        self.name_line(name)
        pbox = self.big_portrait(self.icon('u' if is_u else 'b', e.kind, e.owner, PORT), e.hp / e.max_hp, e.owner)
        self.hp_text(e)
        if e.owner >= 0:
            self.owner_label(e.owner)
        if is_u:
            if e.cls == 'vil' and e.carry >= 1:        # load icon on the portrait (DE)
                S.blit_icon(scr, e.carry_res, (pbox.right - 9, pbox.y + 9), 16)
            rows.append(('atk', f'{e.atk():g}'))
            m, pc = e.armor()
            rows.append(('arm', f'{m:g}/{pc:g}'))
            if e.d['rng'] > 0:
                mn = e.d.get('minr') or 0
                rows.append(('rng', f'{e.rng_tiles():g}' + (f'/{mn:g}' if mn else '')))
            if e.cls == 'vil' and e.owner == 0:
                rate = self.gather_rate(e)
                if rate:
                    rows.append(('work', f'{rate:.1f}'))
                if e.carry >= 1:
                    rows.append((e.carry_res, f'{int(e.carry)}/{int(e.capacity())}'))
            col2 = [('spd', f'{e.speed() / TILE:.2f}')]
            if e.d.get('bonus'):
                for k2, v in list(e.d['bonus'].items())[:2]:
                    col2.append(('bonus', f'+{v} {i18n.t(BONUS_NAMES[k2]) if k2 in BONUS_NAMES else k2}'))
            self.stat_col(rows, y0)
            self.stat_col(col2, y0, TX + 120)
            if e.d.get('monk'):
                full = 62.0 / e.p.stat('faith', e.kind, 1.0)
                fr = 1.0 if w.time >= e.faith_t else max(0.0, 1 - (e.faith_t - w.time) / full)
                bx = TX + 120
                pygame.draw.rect(scr, (25, 20, 18), (bx, y0 + 34, 140, 8))
                pygame.draw.rect(scr, (250, 230, 140), (bx, y0 + 34, int(140 * fr), 8))
                pygame.draw.rect(scr, (90, 62, 24), (bx, y0 + 34, 140, 8), 1)
            if e.naval and e.owner == 0:
                if e.cargo_cap():
                    for i in range(e.cargo_cap()):
                        r = pygame.Rect(TX + 240 + (i % 5) * 34, y0 + (i // 5) * 34, 30, 30)
                        S.slot(scr, r)
                        if i < len(e.cargo):
                            ic = self.icon('u', e.cargo[i].kind, 0, 28)
                            scr.blit(ic, ic.get_rect(center=r.center))
                elif e.d.get('fisher') and e.carry >= 1:
                    self.stat_row(TX + 120, y0 + 24, 'food', f'{int(e.carry)}/{int(e.capacity())}')
            if e.d.get('panel'):
                e.d['panel'](self, e, TX + 240, y0)
            return
        # building
        if not e.complete:
            bar = pygame.Rect(TX, y0 + 8, 260, 16)
            pygame.draw.rect(scr, (40, 30, 20), bar)
            pygame.draw.rect(scr, (90, 140, 200), (bar.x + 1, bar.y + 1, int((bar.w - 2) * e.progress), bar.h - 2))
            pygame.draw.rect(scr, (60, 40, 20), bar, 1)
            S.text(scr, f'{int(e.progress * 100)}%', bar.center, self.fonts['bs'], (255, 255, 255), anchor='center')
            return
        if e.kind == 'farm':
            self.stat_col([('food', str(int(e.amount)))], y0)
            return
        if e.d.get('atk'):
            rows.append(('atk', f'{e.atk():g}' + (f' ×{e.d["arrows"]}' if e.d.get('arrows') else '')))
        m, pc = e.armor()
        rows.append(('arm', f'{m:g}/{pc:g}'))
        if e.d.get('atk'):
            rows.append(('rng', f'{e.rng_tiles():g}'))
        if e.d.get('pop'):
            rows.append(('pop', f'+{e.d["pop"]}'))
        self.stat_col(rows, y0)
        qx = TX + 130
        if e.queue and e.owner == 0:
            self.draw_queue(e, qx, y0 - 2)
        if e.d.get('garrison'):
            self.draw_garrison_info(e, qx, y0 + 52)
        if e.d.get('panel'):           # a panel from content: fn(game, building, x, y) (market prices, reseeds)
            e.d['panel'](self, e, TX + 4 if not e.queue else qx, INFO_BOX.bottom - 22)

    def stat_col(self, rows, y0, x=TX):
        for i, (k, v) in enumerate(rows):
            if k == 'bonus':
                self.text(v, (x, y0 + 10 + i * 20), 'bs', (150, 60, 20), anchor='midleft')
            else:
                self.stat_row(x, y0 + 10 + i * 20, k, v)

    def draw_queue(self, e, x, y):
        """A building's queue: the first one large with a bar, then consecutive identical ones - one icon with a number."""
        scr = self.screen
        p = self.world.players[0]
        mp = pygame.mouse.get_pos()
        groups = []                                    # [(kind, name, [indices])]
        for i, (kind, nm) in enumerate(e.queue):
            if i > 0 and groups and groups[-1][:2] == (kind, nm) and groups[-1][2][0] != 0:
                groups[-1][2].append(i)
            else:
                groups.append((kind, nm, [i]))
        cx = x
        for gi, (kind, nm, idx) in enumerate(groups[:9]):
            s = 44 if gi == 0 else 34
            r = pygame.Rect(cx, y + (0 if gi == 0 else 10), s, s)
            ic = self.icon('u' if kind == 'unit' else 't', nm, 0, s)
            scr.blit(ic, r)
            hov = r.collidepoint(mp)
            S.icon_frame(scr, r, 'hover' if hov else 'normal')
            if hov:
                S.blit_icon(scr, 'cancel', r.center, int(s * 0.7))
            if len(idx) > 1:
                S.text(scr, str(len(idx)), (r.x + 3, r.y + 1), self.fonts['bs'], (255, 255, 255))
            if gi == 0:
                total = p.time_of(kind, nm)
                pygame.draw.rect(scr, (40, 30, 20), (r.x, r.bottom + 3, 44, 6))
                pygame.draw.rect(scr, (60, 150, 60), (r.x + 1, r.bottom + 4, int(42 * min(1, e.qt / total)), 4))
            self.panel_hits.append((r, ('cancel', e, idx)))
            cx = r.right + 4
        if e.housed:
            self.pop_icon(cx + 14, y + 27, 22)
            self.text(i18n.t('hud.need_houses'), (cx + 28, y + 27), 'bs', (170, 30, 20), anchor='midleft')

    def draw_stacks(self, sel):
        """Several selected: identical kinds - one icon with a number (DE), under it a shared HP bar."""
        scr = self.screen
        stacks = {}
        for e in sel:
            stacks.setdefault((e.kind, e.owner, isinstance(e, Unit)), []).append(e)
        mp = pygame.mouse.get_pos()
        x0, y0 = INFO_BOX.x + 10, INFO_BOX.y + 10
        per = 13
        for i, ((kind, owner, is_u), ents) in enumerate(list(stacks.items())[:per * 3]):
            r = pygame.Rect(x0 + (i % per) * 41, y0 + (i // per) * 46, 38, 38)
            ic = self.icon('u' if is_u else 'b', kind, owner, 38)
            scr.blit(ic, r)
            S.icon_frame(scr, r, 'hover' if r.collidepoint(mp) else 'normal')
            if len(ents) > 1:
                S.text(scr, str(len(ents)), (r.x + 2, r.y), self.fonts['bs'], (255, 255, 255))
            frac = sum(max(0, e.hp) for e in ents) / max(1, sum(e.max_hp for e in ents))
            pygame.draw.rect(scr, (25, 20, 20), (r.x, r.bottom + 1, r.w, 4))
            pygame.draw.rect(scr, self.pcolor(owner), (r.x, r.bottom + 1, int(r.w * frac), 4))
            self.panel_hits.append((r, ('stack', ents) if len(ents) > 1 else ('sel', ents[0])))
        self.text(f'{len(sel)}', (INFO_BOX.right - 12, INFO_BOX.bottom - 6), 'b', anchor='bottomright')

    def draw_nothing(self):
        """Nothing selected: clean parchment with the civilization's coat of arms (DE)."""
        key = ('nothing', self.world.players[0].civ)
        img = getattr(self, '_nothing', None) or (None, None)
        if img[0] != key:
            em = civ_ui.emblem(self.world.players[0].civ, 70, 84).copy()
            em.fill((255, 255, 255, 60), special_flags=pygame.BLEND_RGBA_MULT)
            img = (key, em)
            self._nothing = img
        self.screen.blit(img[1], img[1].get_rect(center=INFO_BOX.center))

    def vil_job(self, u):
        t = u.target
        if u.state == 'build':
            return 'build'
        if u.state in ('gather', 'return') and t is not None:
            if isinstance(t, Animal):
                return 'hunt'
            if isinstance(t, Building):
                return 'farm' if t.kind == 'farm' else None
            if t.kind == 'tree':
                return 'wood'
            if t.kind in ('gold', 'stone', 'berries'):
                return t.kind
            return 'fish'
        return None

    def gather_rate(self, u):
        """A villager's gather rate per minute (like the "work rate" in DE) or 0."""
        t = u.target
        if u.state not in ('gather', 'return') or t is None:
            return 0
        if isinstance(t, Animal):
            base, res, src = ANIMALS.get(t.kind, {}).get('rate', 0.4), 'food', 'hunt'
        elif isinstance(t, Building):
            if t.kind != 'farm':
                return 0
            base, res, src = FARM_RATE, 'food', 'farm'
        else:
            base, res, src = NODE_DEFS.get(t.kind, {}).get('rate', 0.35), t.res, t.kind
        return u.p.stat('gather', u.kind, base, res, src) * 60

    # ============================================================ command grid
    def grid_rect(self, slot):
        return pygame.Rect(GRID_X + (slot % 5) * GRID_STEP, GRID_Y + (slot // 5) * GRID_STEP, BTN, BTN)

    def grid_layout(self, items, fixed=()):
        """items / fixed - dict(icon, act, ok, tip[, slot]). Items with a 'slot' stand in their own place (DE),
        the rest fill the free cells; if they do not fit - paging (the last cell)."""
        GRID = 15
        fixed_slots = {}
        base = GRID - len(fixed)
        for i, f in enumerate(fixed):
            fixed_slots[f.get('slot', base + i)] = f
        taken = dict(fixed_slots)
        free = []
        for it in items:
            s = it.get('slot')
            if s is not None and s not in taken:
                taken[s] = it
            else:
                free.append(it)
        empty = [s for s in range(GRID) if s not in taken]
        slots = []
        if len(free) <= len(empty):
            slots = list(taken.items()) + list(zip(empty, free))
        else:
            # does not fit: everything in a row across pages, the fixed ones on every page
            allit = [taken[s] for s in sorted(taken) if s not in fixed_slots] + free
            per = GRID - len(fixed_slots) - 1
            pages = (len(allit) + per - 1) // per
            page = self.cmd_page % pages
            shown = allit[page * per:(page + 1) * per]
            open_slots = [s for s in range(GRID - 1) if s not in fixed_slots]
            slots = list(zip(open_slots, shown)) + list(fixed_slots.items())
            slots.append((GRID - 1, dict(icon=('page', (page, pages)), act=('page', None), ok=True,
                                         tip=[i18n.t('hud.page', n=page + 1, m=pages), {}, i18n.t('hud.more_buttons')])))
        btns = []
        for slot, it in slots:
            btns.append(dict(it, rect=self.grid_rect(slot), key=HOTKEYS[slot]))
        return btns

    def set_build_page(self, page):
        self.build_page = page

    def villager_items(self, p):
        """The villager grid (DE): the main one - Q "economy", W "military"; pages with fixed places,
        V - to the other page, B - back."""
        key = tuple(id(e) for e in self.selected[:3])
        if key != self._bp_key:
            self._bp_key = key
            self.build_page = None
        if self.build_page is None:
            return [dict(icon=('bpage', ('eco', 'house')), act=('call', lambda g: g.set_build_page('eco')), ok=True,
                         tip=[i18n.t('hud.build_eco'), {}, i18n.t('hud.build_eco_desc')], slot=0),
                    dict(icon=('bpage', ('mil', 'barracks')), act=('call', lambda g: g.set_build_page('mil')),
                         ok=True, tip=[i18n.t('hud.build_mil'), {}, i18n.t('hud.build_mil_desc')], slot=1)]
        page = ECO_PAGE if self.build_page == 'eco' else MIL_PAGE
        other = MIL_PAGE if page is ECO_PAGE else ECO_PAGE
        items = []
        used = set()
        for k0 in BUILD_MENU:
            k = p.current(k0)
            if k0 in other or not p.allows(k0) or not p.allows(k):
                continue
            if k0 not in page and self.build_page != 'eco':
                continue                               # unknown buildings - to the economy page
            d = BUILDINGS[k]
            cost = p.cost_of('bld', k)
            locked = self.world.build_age(p, k) > p.age
            tip = [d['name'], cost, d['desc']]
            if locked:
                tip.append(('red', i18n.t('msg.need_age', age=AGE_NAMES[d['age']])))
            s = page.get(k0)
            if s in used:
                s = None
            used.add(s)
            items.append(dict(icon=('b', k), act=('place', k), ok=not locked and p.afford(cost), tip=tip, slot=s))
        items.append(dict(icon=('next', None), act=('call', lambda g: g.set_build_page(
            'mil' if g.build_page == 'eco' else 'eco')), ok=True,
            tip=[i18n.t('hud.next_page'), {}, i18n.t('hud.mil_buildings') if page is ECO_PAGE else i18n.t('hud.eco_buildings')],
            slot=13))
        items.append(dict(icon=('back', None), act=('call', lambda g: g.set_build_page(None)), ok=True,
                          tip=[i18n.t('common.back'), {}, i18n.t('hud.back_to_villager')], slot=14))
        return items

    def building_slots(self, b, p, items):
        """Fixed places of a building's buttons (DE): units - the top row, line upgrades - the second,
        other techs - the third; in the center - the DE layout (TC_SLOTS). Changes items in place."""
        if b.kind == 'town_center':
            for it in items:
                a = it['act']
                nm = a[2] if a[0] in ('train', 'research') else None
                if a[0] == 'train':
                    nm = next((k for k in b.d.get('trains', []) if p.current(k) == a[2]), a[2])
                if nm in TC_SLOTS:
                    it['slot'] = TC_SLOTS[nm]
                elif a[0] in ('bell', 'clear'):
                    it['slot'] = 14
                elif a[0] == 'eject':
                    it['slot'] = 9
            return items
        trains = [k for k in b.d.get('trains', []) if p.allows(k, b.kind) and p.allows(p.current(k))]
        chains = self.tech_chains(b, p)
        has_units = bool(trains)
        rows = {0: 0, 1: 0, 2: 0}
        chain_slot = {}
        for ci, chain in enumerate(chains):
            up = any(TECHS[t].get('upgrade') for t in chain)
            row = (1 if up else 2) if has_units else None
            if row is None:
                chain_slot[ci] = ci if ci < 15 else None
            else:
                chain_slot[ci] = row * 5 + rows[row] if rows[row] < 5 else None
                rows[row] += 1
        for it in items:
            a = it['act']
            if a[0] == 'train':
                i = next((j for j, k in enumerate(trains) if p.current(k) == a[2]), None)
                it['slot'] = i if i is not None and i < 5 else None
            elif a[0] == 'research':
                ci = next((j for j, ch in enumerate(chains) if a[2] in ch), None)
                it['slot'] = chain_slot.get(ci)
        return items

    def tech_chains(self, b, p):
        """A building's tech chains (the next one replaces the previous one in the same place)."""
        key = ('chains', b.kind, p.id, p.civ)
        cache = self.__dict__.setdefault('_chains', {})
        if key in cache:
            return cache[key]
        techs = [t for t in b.d.get('techs', []) if p.allows(t) and t in TECHS and t not in AGE_TECHS]
        chains = []
        where = {}
        for t in techs:
            reqs = [r for r in as_tuple(TECHS[t].get('req', ())) if r in where]
            if reqs:
                ch = where[reqs[0]]
                chains[ch].append(t)
                where[t] = ch
            else:
                where[t] = len(chains)
                chains.append([t])
        cache[key] = chains
        return chains

    # ============================================================ minimap
    def mm_color(self, owner):
        if not self.mm_team or owner < 0:
            return self.pcolor(owner)
        return TEAM_COLORS[self.relation(owner) if self.relation(owner) in TEAM_COLORS else 'enemy']

    def minimap_button(self, act):
        self.audio.click()
        if act == 'flare':             # signal mode from controls.py: the next left click on the map or world
            self.order_mode = None if self.order_mode == 'flare' else 'flare'
        elif act == 'score':
            self.show_score = not self.show_score
        elif act == 'colors':
            self.mm_team = not self.mm_team
            self.mm_img = None
        elif act == 'mode':
            self.mm_mode = (self.mm_mode + 1) % len(MM_MODES)
            self.mm_img = None

    def draw_minimap(self):
        scr = self.screen
        w = self.world
        r = self.mm_rect()
        self.mm_t -= 1
        mode = self.mm_mode
        if self.mm_img is None or self.mm_t <= 0:
            self.mm_t = 10
            small = self.mm_base.copy()
            if mode == 1:                               # military: the ground is muted
                small.fill((70, 70, 70), special_flags=pygame.BLEND_RGB_MULT)
            MAP_W, MAP_H = w.W, w.H
            arow = w.amat[0]
            exp, vis = w.explored, w.vis
            if mode != 1:
                # DE object colors (game/themes.py): gold #FFC700, stone #919191, all food #A5C46C,
                # forest - the color of the landscape's forest floor
                node_c = {'tree': themes.forest_mm(w), 'gold': themes.MM_GOLD, 'stone': themes.MM_STONE}
                for n in w.nodes:
                    if n.alive and exp[n.ty * MAP_W + n.tx]:
                        c = node_c.get(n.kind) or (themes.MM_FOOD if NODE_DEFS[n.kind].get('res') == 'food'
                                                   else NODE_DEFS[n.kind].get('mm', (255, 255, 255)))
                        if mode == 2 and n.kind == 'tree':
                            c = (60, 150, 60)
                        small.set_at((n.tx, n.ty), c)
            for b in w.buildings:
                if b.seen:
                    if mode == 2 and (b.d.get('trains') and not b.d.get('drop') and b.kind != 'market'):
                        continue
                    small.fill(self.mm_color(b.owner) if not b.walk else (190, 160, 90), (b.tx, b.ty, b.w, b.h))
            buf = bytearray(MAP_W * MAP_H * 4)
            for i in range(MAP_W * MAP_H):
                if not exp[i]:
                    buf[i * 4 + 3] = 255
                elif not vis[i]:
                    buf[i * 4 + 3] = 110
            small.blit(pygame.image.frombuffer(bytes(buf), (MAP_W, MAP_H), 'RGBA'), (0, 0))
            for u in w.units:
                if mode == 1 and u.cls == 'vil' or mode == 2 and u.cls != 'vil':
                    continue
                if arow[u.owner] or w.visible_px(u.x, u.y):
                    small.set_at((int(u.x // TILE), int(u.y // TILE)), shade(self.mm_color(u.owner), 60))
            if mode != 1:
                rc = _relic_mm_color()
                for rl in getattr(w, 'relics', ()):         # relics (game/relics.py): a white dot
                    tx, ty = int(rl.x // TILE), int(rl.y // TILE)
                    if 0 <= tx < MAP_W and 0 <= ty < MAP_H and (exp[ty * MAP_W + tx] if rl.carrier is None
                                                                 else w.visible_px(rl.x, rl.y)):
                        small.fill(rc, (tx, ty, 2, 2) if rl.holder is None else (tx, ty, 1, 1))
                for a in w.animals:
                    if (arow[a.owner] or w.visible_px(a.x, a.y)) and not a.dead:
                        c = shade(self.mm_color(a.owner), 60) if a.owner >= 0 else \
                            (themes.MM_FOOD if a.d.get('food') else themes.MM_WOLF)
                        small.set_at((int(a.x // TILE), int(a.y // TILE)), c)
            sq = pygame.transform.scale(small.convert_alpha(), (MAP_W * 2, MAP_H * 2))
            rot = pygame.transform.rotate(sq, -45)
            self.mm_img = pygame.transform.smoothscale(rot, (r.w, r.h))
        scr.blit(self.mm_img, r)
        tw, th = self.iso_tw, self.iso_th
        cam = pygame.Rect(r.x + self.cam_x / tw * r.w, r.y + self.cam_y / th * r.h,
                          self.view_w() / tw * r.w, self.view_h() / th * r.h)     # taking the scale into account
        scr.set_clip(r)
        pygame.draw.rect(scr, (255, 255, 255), cam, 1)
        scr.set_clip(None)
        for (x, y, t) in w.pings:
            a = (w.time - t) % 1.0
            mx, my = self.world_to_mm(x, y)
            pygame.draw.circle(scr, (255, 80, 60), (int(mx), int(my)), int(4 + a * 10), 2)
        # 4 buttons in the corners
        self.mm_btn_rects = []
        mp = pygame.mouse.get_pos()
        corners = [(MAP_PANEL.x + 24, MAP_PANEL.y + 24), (MAP_PANEL.right - 24, MAP_PANEL.y + 24),
                   (MAP_PANEL.x + 24, MAP_PANEL.bottom - 24), (MAP_PANEL.right - 24, MAP_PANEL.bottom - 24)]
        for act, c in zip(MM_BTNS, corners):
            br = pygame.Rect(c[0] - 16, c[1] - 16, 32, 32)
            self.mm_btn_rects.append((br, act))
            on = (act == 'flare' and self.order_mode == 'flare') or (act == 'score' and self.show_score) or \
                 (act == 'colors' and self.mm_team) or (act == 'mode' and self.mm_mode)
            h = br.collidepoint(mp)
            pygame.draw.circle(scr, (14, 10, 6), (c[0] + 1, c[1] + 2), 16)
            pygame.draw.circle(scr, (46, 36, 26) if not h else (80, 62, 40), c, 15)
            pygame.draw.circle(scr, S.GOLD_HI if on or h else (150, 118, 70), c, 15, 2)
            mm_btn_icon(scr, act, c, self.mm_mode, self.pcolor(0))
            if h:
                T = i18n.t
                tips = {'flare': [T('hud.flare'), {}, T('hud.flare_desc')],
                        'score': [T('keys.score'), {}, 'F4'],
                        'colors': [T('hud.colors'), {}, T('lobby.teams') if not self.mm_team else T('lobby.players')],
                        'mode': [T('hud.map_mode'), {}, T(MM_MODES[self.mm_mode])]}[act]
                self.draw_tip(tips, anchor=(MAP_PANEL.x - 200, MAP_PANEL.y - 4))

    # ---- score above the minimap (F4)
    def draw_score(self):
        if not self.show_score:
            return
        w = self.world
        scores = hud_windows.scores(self)
        players = sorted(w.players, key=lambda q: (q.team != w.players[0].team, q.team, q.id))
        # normal mode - points; military - the number of soldiers; economic - villagers (DE)
        lines = []
        for q in players:
            if self.mm_mode == 0:
                v = scores[q.id]['total']
            else:
                v = sum(1 for u in w.units if u.owner == q.id and (u.cls == 'vil') == (self.mm_mode == 2))
            lines.append((q, v))
        f = self.fonts['bs']
        wmax = max(f.size(f'{q.name}: {s}')[0] for q, s in lines) + 64
        y = MAP_PANEL.y - 6 - 20 * len(lines)
        box = pygame.Rect(SCREEN_W - wmax - 8, y - 4, wmax + 6, 20 * len(lines) + 6)
        S.shade_overlay(self.screen, box, alpha=130)
        if self.mm_mode:                                # mode icon to the left of the list
            c = (box.x - 14, box.y + 12)
            pygame.draw.circle(self.screen, (40, 32, 24), c, 12)
            mm_btn_icon(self.screen, 'mode', c, self.mm_mode, self.pcolor(0))
        for i, (q, s) in enumerate(lines):
            yy = y + i * 20 + 9
            col = q.color if q.alive else (130, 120, 110)
            tb = pygame.Rect(box.x + 4, yy - 7, 14, 14)
            pygame.draw.rect(self.screen, col, tb)
            S.text(self.screen, str(q.team + 1), tb.center, self.fonts['s'], (255, 255, 255), anchor='center')
            txt = f'{q.name}: {s}'
            r = S.text(self.screen, txt, (tb.right + 6, yy), f, shade(col, 50), anchor='midleft')
            if not q.alive:
                pygame.draw.line(self.screen, (230, 90, 70), (r.x, r.centery), (r.right, r.centery), 1)
            self.age_shield(SCREEN_W - 16, yy, q.age, 16, shade(q.color, -50))

    # ============================================================ overlays
    def dim(self, alpha=160):
        S.shade_overlay(self.screen, (0, 0, SCREEN_W, SCREEN_H), alpha=alpha)

    def draw_overlays(self):
        """Windows over the game: a window (objectives, chat, diplomacy, tree), then help / card / the match menu."""
        if self.window:
            hud_windows.draw(self, self.window)
        if self.show_history:
            hud_windows.draw_history(self)
        if self.help == 'civ':
            civ_ui.draw_overlay(self)
        elif self.help == 'menu':
            self.draw_game_menu()
        elif self.help:
            self.draw_help()

    def title_bar(self, box, title, icon=None):
        """A panel heading: a golden inscription in the center, ornamental lines on the sides."""
        scr = self.screen
        img = S.gold_text(title, self.fonts['h'])
        r = img.get_rect(center=(box.centerx, box.y + 30))
        scr.blit(img, r)
        for side in (-1, 1):
            x0 = r.left - 16 if side < 0 else r.right + 16
            x1 = box.x + 30 if side < 0 else box.right - 30
            pygame.draw.line(scr, S.GOLD_DK, (x0, r.centery), (x1, r.centery), 2)
            pygame.draw.line(scr, (30, 20, 10), (x0, r.centery + 2), (x1, r.centery + 2), 1)
            pts = [(x0, r.centery - 5), (x0 + 5 * -side, r.centery), (x0, r.centery + 5), (x0 + 5 * side, r.centery)]
            pygame.draw.polygon(scr, S.GOLD_HI, pts)
        if icon:
            S.blit_icon(scr, icon, (r.left - 40, r.centery), 30)

    def draw_help(self):
        scr = self.screen
        self.dim(170)
        box = pygame.Rect(SCREEN_W // 2 - 360, 56, 720, 640)
        S.panel(scr, box, 'stone', ornate=True)
        self.title_bar(box, i18n.t('gm.help'), 'encyclopaedia')
        y = box.y + 66
        for k, v in HELP_ROWS:
            k = i18n.t(k) if k.startswith('help.') else k
            v = i18n.t(v)
            # keys - "pebbles"
            kx = box.x + 34
            for part in k.split(' · '):
                img = self.fonts['bs'].render(part, True, (255, 232, 170))
                cap = pygame.Rect(kx, y - 1, img.get_width() + 14, 22)
                S.slot(scr, cap)
                S.bevel(scr, cap, width=1)
                scr.blit(img, img.get_rect(center=cap.center))
                kx = cap.right + 6
            arrow = [(box.x + 368, y + 5), (box.x + 378, y + 10), (box.x + 368, y + 15)]
            pygame.draw.polygon(scr, S.GOLD_DK, arrow)
            self.text(v, (box.x + 392, y + 10), 'm', S.TEXT, anchor='midleft')
            y += 26
        goal = pygame.Rect(box.x + 30, box.bottom - 46, box.w - 60, 30)
        S.panel(scr, goal, 'parchment', frame=False)
        S.blit_icon(scr, 'victory', (goal.x + 20, goal.centery), 24)
        S.text_fit(scr, i18n.t('hud.goal'), (goal.centerx + 10, goal.centery),
                   self.fonts['b'], S.INK, anchor='center', shadow=None, max_w=goal.w - 60)

    def game_menu_rects(self):
        box = pygame.Rect(SCREEN_W // 2 - 190, 170, 380, 110 + len(GAME_MENU) * 66)
        return box, [(pygame.Rect(box.x + 40, box.y + 80 + i * 66, box.w - 80, 52), act, lbl, ic)
                     for i, (act, lbl, ic) in enumerate(GAME_MENU)]

    def draw_game_menu(self):
        scr = self.screen
        self.dim(150)
        box, items = self.game_menu_rects()
        S.panel(scr, box, 'stone', ornate=True)
        self.title_bar(box, i18n.t('keys.pause'))
        mp = pygame.mouse.get_pos()
        for r, act, lbl, ic in items:
            h = r.collidepoint(mp)
            S.button(scr, r, 'hover' if h else 'normal')
            S.blit_icon(scr, ic, (r.x + 30, r.centery), 30)
            S.text_fit(scr, i18n.t(lbl), (r.centerx + 12, r.centery), self.fonts['btn'],
                       (255, 236, 190) if h else (240, 222, 180), anchor='center', max_w=r.w - 70)

    def overlay_click(self, pos):
        """Left click while an overlay is open (help, card, match menu)."""
        if self.help == 'menu':
            box, items = self.game_menu_rects()
            for r, act, _, _ in items:
                if r.collidepoint(pos):
                    self.audio.click()
                    if act == 'resume':
                        self.help = False
                    elif act == 'help':
                        self.help = True
                    elif act == 'civ':
                        self.help = 'civ'
                    elif act == 'quit':
                        self.help = False
                        self.state = 'menu'
                        self.menu_screen = 'main'
                    return
            if not box.collidepoint(pos):
                self.help = False
            return
        self.help = False

    def draw_gameover(self):
        scr = self.screen
        w = self.world
        self.dim(150)
        win = w.human_won()
        box = pygame.Rect(SCREEN_W // 2 - 280, 150, 560, 420)
        S.panel(scr, box, 'stone', ornate=True)
        S.blit_icon(scr, 'victory' if win else 'defeat', (box.centerx, box.y + 60), 96)
        img = S.gold_text(i18n.t('end.victory_bang').upper() if win else i18n.t('end.defeat').upper(), self.fonts['xl'],
                          *(((255, 240, 170), (210, 150, 50)) if win else ((255, 170, 140), (160, 40, 30))))
        scr.blit(img, img.get_rect(center=(box.centerx, box.y + 140)))
        t = int(w.time)
        p = w.players[0]
        tiles = [('time', f'{t // 60:02d}:{t % 60:02d}'), ('age', AGE_NAMES[p.age]),
                 ('economics', str(int(sum(p.gathered.values())))), ('kill', str(p.kills))]
        tw = (box.w - 60) // len(tiles)
        for i, (ic, val) in enumerate(tiles):
            r = pygame.Rect(box.x + 30 + i * tw, box.y + 190, tw - 12, 110)
            S.panel(scr, r, 'parchment', frame=False)
            pygame.draw.rect(scr, (92, 62, 28), r, 1)
            if ic == 'age':
                a = S.portrait('age', p.age, None, 44)
                if a is not None:
                    scr.blit(a, a.get_rect(center=(r.centerx, r.y + 36)))
            elif ic == 'time':
                hourglass(scr, r.centerx, r.y + 36, 18, S.INK)
            else:
                S.blit_icon(scr, ic, (r.centerx, r.y + 36), 40)
            f = self.fonts['bs'] if len(val) > 8 else self.fonts['l']
            S.text(scr, val, (r.centerx, r.y + 84), f, S.INK, anchor='center', shadow=None)
        br = pygame.Rect(box.centerx - 150, box.bottom - 84, 300, 54)
        h = br.collidepoint(pygame.mouse.get_pos())
        S.button(scr, br, 'hover' if h else 'normal')
        S.text_fit(scr, i18n.t('menu.to_main'), br.center, self.fonts['btn'], (255, 236, 190), anchor='center',
                   max_w=br.w - 20)

    # ============================================================ cursor
    def update_cursor(self):
        cur = getattr(self, 'cursors', None)
        if cur is None:
            return
        if self.state != 'play':
            cur.set('arrow')
            return
        self._cursor_t += 1
        if self._cursor_t % 3:
            return
        cur.set(self.cursor_kind(pygame.mouse.get_pos()))

    # order mode (controls.order_mode) -> cursor (DE: each mode has its own icon)
    ORDER_CURSORS = {'flare': 'flare', 'patrol': 'patrol', 'guard': 'guard', 'follow': 'follow',
                     'amove': 'amove', 'aground': 'aground'}

    def cursor_kind(self, mp):
        """Cursor state by what is under the mouse (docs/research/08_cursor.md, DE)."""
        w = self.world
        if self.help or w.winner is not None or not self.in_view(mp):
            return 'arrow'
        if self.placing:
            return 'build' if self.place_ok(mp) else 'no'
        mode = getattr(self, 'order_mode', None)
        if mode:                                        # waiting for a left click
            return self.ORDER_CURSORS.get(mode, 'attack')
        units = [u for u in self.selected if isinstance(u, Unit) and u.owner == 0 and u.alive]
        if not units:
            # a unit-training building is selected: right click sets a rally point - a flag (DE)
            if any(isinstance(s, Building) and s.owner == 0 and s.complete and s.d.get('trains')
                   for s in self.selected):
                return 'rally'
            return 'arrow'
        e = self.entity_at(mp)
        ships = [u for u in units if u.naval]
        land = [u for u in units if not u.naval]
        if e is None:
            # a transport with passengers over land: unload
            if ships and any(getattr(s, 'cargo', None) for s in ships) and self.land_at(mp):
                return 'unload'
            return 'arrow'
        vils = any(u.kind == 'villager' for u in units)
        # a trade cart -> a market (own or allied, completed)
        if isinstance(e, Building) and e.kind == 'market' and e.complete and e.owner >= 0 and \
                w.allied(0, e.owner) and any(u.d.get('command') for u in units):
            return 'trade'
        # land units -> own transport: board
        if land and isinstance(e, Unit) and e.naval and e.owner == 0 and getattr(e, 'cargo_cap', lambda: 0)() > 0:
            return 'board'
        if isinstance(e, Animal):
            if vils and e.den is None:
                return 'meat'
            return 'attack' if not e.dead else 'arrow'
        if e.owner >= 0 and w.hostile(0, e.owner):
            return 'attack'
        if isinstance(e, Node) and vils:
            if e.kind in ('tree', 'stone', 'gold', 'berries'):
                return e.kind
            return 'fish'
        if isinstance(e, Node) and ships and any(s.d.get('fisher') for s in ships):
            return 'fish'
        if isinstance(e, Unit) and any(u.d.get('monk') for u in units) and w.allied(0, e.owner) \
                and e.hp < e.max_hp:
            return 'heal'
        if isinstance(e, Unit) and vils and e.owner == 0 and e.cls in ('siege', 'ship') and e.hp < e.max_hp:
            return 'repair'
        if isinstance(e, Building) and e.owner == 0 and vils:
            if not e.complete:
                return 'build'
            if e.kind == 'farm':
                return 'farm'
            if e.d.get('drop') and any(u.carry > 0 for u in units):
                return 'drop'
            if e.hp < e.max_hp:
                return 'repair'
        if isinstance(e, Building) and e.owner == 0 and e.complete and e.d.get('water') and ships and \
                any(s.carry > 0 for s in ships):
            return 'drop'
        if isinstance(e, Building) and e.owner == 0 and e.complete and e.d.get('garrison') and \
                self.garrison_wanted(units, e):
            # right click on your own building with a garrison; DE: a villager without a load enters the center without Alt
            return 'garrison' if self.garrison_room(e) > 0 else 'no'
        return 'arrow'

    def place_ok(self, mp):
        """Whether the selected building can be placed under the cursor (otherwise the "no" cursor)."""
        try:
            tx, ty = self.place_tile(mp)
            return bool(self.world.can_place(self.placing, tx, ty, 0))
        except Exception:
            return True

    def land_at(self, mp):
        wx, wy = self.s2w(*mp)
        w = self.world
        tx, ty = int(wx // TILE), int(wy // TILE)
        return 0 <= tx < w.W and 0 <= ty < w.H and w.terrain[ty][tx] in (0, 2)

    def garrison_wanted(self, units, b):
        """Garrison by right click (defense_ui.garrison_command): the required class and - for villagers near a storage - empty hands
        or Alt."""
        allowed = b.d.get('garrison_cls', ('vil', 'inf', 'arch'))
        cands = [u for u in units if u.cls in allowed]
        if not cands:
            return False
        vils = [u for u in units if u.kind == 'villager']
        if b.d.get('drop') and vils and not (self.mods() & pygame.KMOD_ALT) and any(u.carry > 0 for u in vils):
            return False
        return True

    def garrison_room(self, b):
        try:
            from . import defense
            return defense.capacity(b) - len(b.garrison)
        except Exception:
            return 1


def _relic_mm_color():
    try:
        from . import themes
        return getattr(themes, 'MM_RELIC', (255, 255, 255))
    except Exception:
        return (255, 255, 255)


# ================================================================ procedural icons
def stat_icon(kind, size):
    """A stat icon (the DE dictionary, otherwise a 0 A.D. portrait)."""
    return S.icon(STAT_ICONS[kind], size) or S.icon(STAT_ICONS_0AD[kind], size)


def wrap(s, f, maxw):
    out, cur = [], ''
    for word in s.split():
        t = (cur + ' ' + word).strip()
        if f.size(t)[0] > maxw and cur:
            out.append(cur)
            cur = word
        else:
            cur = t
    if cur:
        out.append(cur)
    return out


def idle_figure(scr, c):
    """A villager silhouette with an axe (the idle button, DE)."""
    cx, cy = c
    col = (40, 28, 14)
    pygame.draw.circle(scr, col, (cx - 1, cy - 9), 4)
    pygame.draw.polygon(scr, col, [(cx - 6, cy - 4), (cx + 4, cy - 4), (cx + 6, cy + 5), (cx - 7, cy + 5)])
    pygame.draw.line(scr, col, (cx - 4, cy + 5), (cx - 5, cy + 12), 3)
    pygame.draw.line(scr, col, (cx + 3, cy + 5), (cx + 4, cy + 12), 3)
    pygame.draw.line(scr, col, (cx + 4, cy - 2), (cx + 11, cy - 10), 2)
    pygame.draw.polygon(scr, col, [(cx + 9, cy - 13), (cx + 14, cy - 11), (cx + 12, cy - 7)])


def hp_glyph(scr, x, cy):
    """Health in a tooltip: a bar like under the portrait (DE), no heart."""
    pygame.draw.rect(scr, (10, 10, 10), (x, cy - 4, 16, 8))
    pygame.draw.rect(scr, (60, 200, 60), (x + 1, cy - 3, 14, 6))
    pygame.draw.line(scr, (160, 250, 150), (x + 1, cy - 3), (x + 14, cy - 3))


def heart(scr, cx, cy, col=(210, 30, 30)):
    pygame.draw.circle(scr, col, (cx - 3, cy - 2), 4)
    pygame.draw.circle(scr, col, (cx + 3, cy - 2), 4)
    pygame.draw.polygon(scr, col, [(cx - 7, cy - 1), (cx + 7, cy - 1), (cx, cy + 7)])


def hammer(scr, cx, cy, col):
    pygame.draw.line(scr, (20, 14, 8), (cx - 5, cy + 6), (cx + 3, cy - 2), 4)
    pygame.draw.line(scr, (150, 100, 50), (cx - 5, cy + 6), (cx + 3, cy - 2), 2)
    pygame.draw.polygon(scr, (20, 14, 8), [(cx - 1, cy - 8), (cx + 8, cy + 1), (cx + 5, cy + 4), (cx - 4, cy - 5)])
    pygame.draw.polygon(scr, col, [(cx, cy - 7), (cx + 7, cy), (cx + 5, cy + 2), (cx - 2, cy - 5)])


def next_arrow(scr, r):
    """A red "next page" arrow (DE)."""
    cx, cy = r.center
    pts = [(cx - 12, cy - 5), (cx + 1, cy - 5), (cx + 1, cy - 11), (cx + 13, cy), (cx + 1, cy + 11), (cx + 1, cy + 5),
           (cx - 12, cy + 5)]
    pygame.draw.polygon(scr, (200, 40, 24), pts)
    pygame.draw.polygon(scr, (255, 150, 110), pts, 1)


def back_cross(scr, r):
    """A red "back" cross (DE)."""
    cx, cy = r.center
    for d in (1, -1):
        pygame.draw.line(scr, (60, 10, 6), (cx - 11, cy - 11 * d), (cx + 11, cy + 11 * d), 7)
        pygame.draw.line(scr, (220, 40, 30), (cx - 10, cy - 10 * d), (cx + 10, cy + 10 * d), 4)


def chat_icon(scr, c):
    """A speech bubble (the "Chat" button)."""
    cx, cy = c
    pygame.draw.ellipse(scr, (235, 225, 200), (cx - 11, cy - 9, 22, 15))
    pygame.draw.polygon(scr, (235, 225, 200), [(cx - 5, cy + 4), (cx - 8, cy + 10), (cx + 1, cy + 5)])
    for dx in (-5, 0, 5):
        pygame.draw.circle(scr, (80, 60, 40), (cx + dx, cy - 2), 2)


def mm_btn_icon(scr, act, c, mode, color):
    cx, cy = c
    if act == 'flare':                    # flash
        for i in range(8):
            v = pygame.Vector2(0, -10).rotate(i * 45)
            pygame.draw.line(scr, (255, 220, 120), (cx, cy), (cx + v.x, cy + v.y), 2)
        pygame.draw.circle(scr, (255, 250, 220), c, 4)
    elif act == 'score':                  # score columns
        for i, (h, col) in enumerate(((8, (220, 60, 50)), (14, (70, 120, 230)), (11, (235, 235, 235)))):
            pygame.draw.rect(scr, col, (cx - 9 + i * 7, cy + 7 - h, 5, h))
    elif act == 'colors':                 # DE: a globe (team colors)
        pygame.draw.circle(scr, (40, 96, 190), c, 10)
        for dx, dy, r in ((-3, -3, 4), (3, 2, 3), (-2, 4, 2), (5, -4, 2)):
            pygame.draw.circle(scr, (70, 160, 70), (cx + dx, cy + dy), r)
        pygame.draw.ellipse(scr, (190, 220, 250), (cx - 4, cy - 10, 8, 20), 1)
        pygame.draw.line(scr, (190, 220, 250), (cx - 10, cy), (cx + 10, cy), 1)
        pygame.draw.circle(scr, (20, 14, 8), c, 10, 1)
    else:                                 # mode: normal - ground, military - a sword, economic - a sack
        if mode == 1:
            pygame.draw.line(scr, (220, 220, 230), (cx - 7, cy + 7), (cx + 7, cy - 7), 3)
            pygame.draw.line(scr, (160, 110, 50), (cx - 6, cy + 1), (cx - 1, cy + 6), 3)
        elif mode == 2:
            pygame.draw.circle(scr, (240, 200, 40), (cx, cy + 2), 7)
            pygame.draw.rect(scr, (240, 200, 40), (cx - 3, cy - 8, 6, 5))
        else:                             # DE: sunset - the sun over the horizon
            for i in range(20):
                t = i / 19
                col = (int(250 - 60 * t), int(200 - 150 * t), int(90 - 50 * t))
                w = int((100 - (i - 10) ** 2) ** 0.5)
                pygame.draw.line(scr, col, (cx - w, cy - 10 + i), (cx + w, cy - 10 + i))
            pygame.draw.circle(scr, (255, 240, 170), (cx, cy + 2), 5, draw_top_left=True, draw_top_right=True)
            pygame.draw.line(scr, (60, 30, 20), (cx - 9, cy + 3), (cx + 9, cy + 3), 2)
            pygame.draw.circle(scr, (20, 14, 8), c, 10, 1)


def hourglass(scr, cx, cy, s, col):
    """An hourglass (the time icon) - an outline in color col."""
    top = [(cx - s * 0.6, cy - s), (cx + s * 0.6, cy - s), (cx, cy)]
    bot = [(cx - s * 0.6, cy + s), (cx + s * 0.6, cy + s), (cx, cy)]
    pygame.draw.polygon(scr, (200, 160, 90), [(cx - s * 0.3, cy - s * 0.5), (cx + s * 0.3, cy - s * 0.5), (cx, cy)])
    pygame.draw.polygon(scr, (200, 160, 90), [(cx - s * 0.5, cy + s * 0.9), (cx + s * 0.5, cy + s * 0.9),
                                             (cx, cy + s * 0.4)])
    pygame.draw.polygon(scr, col, top, 2)
    pygame.draw.polygon(scr, col, bot, 2)
    for y in (cy - s - 2, cy + s + 2):
        pygame.draw.line(scr, col, (cx - s * 0.8, y), (cx + s * 0.8, y), 4)
