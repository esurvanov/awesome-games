"""The game screen: the isometric camera, drawing, input, panels."""
import math
import random
import time
from operator import itemgetter

import pygame

from .data import (TILE, HW, HH, SCREEN_W, SCREEN_H, TOP_H, PANEL_H, VIEW_H,
                   FPS, GAME_SPEED, PLAYER_COLORS, AGE_NAMES, NODE_DEFS,
                   FARM_FOOD, ANIMALS, UNITS, BUILDINGS, TECHS, AGE_TECHS, HOTKEYS, shade, to_iso, from_iso,
                   as_tuple)
from .world import World, Unit, Building, Node, Animal
from .ai import AI
from . import gfx, naval, naval_gfx, sprites3d, sprites_extra
from . import terrain, terrain_gfx, map_assets
from . import sound
from .defense_ui import DefenseUI
from .controls import ControlsUI
from . import orders, controls_draw, relics
from .hud import HudUI, MM_RECT
from .menu import MenuUI
from .lobby import LobbyUI
from .screens import ScreensUI
from . import i18n, uiskin
from . import settings as gsettings

SPEEDS = [1.0, 1.5, GAME_SPEED, 2.0, 3.0]
ZOOMS = (0.6, 0.7, 0.8, 0.9, 1.0, 1.12, 1.25, 1.4, 1.6)     # wheel zoom steps (1.0 - normal)
FOG_S = 8          # how many times the fog is coarser than the screen
UNIT_K = 1.15      # figure scale

_DEPTH_KEY = itemgetter(0, 1)      # drawing order: depth, then type (resource, building, unit, animal)

# the unit figure cache (see Game.draw_unit_w): pose key -> (surface, x offset, y offset)
_USPR = {}
_UCANVAS = []
_TAU = math.tau
_ANIM_Q = 16 / math.tau
_U_OX, _U_OY, _U_W, _U_H = 56, 98, 112, 112        # the "feet" point and the size of the scratch surface (the largest is the trebuchet)
# 8 look directions; x is never 0 - the figure's facing depends on the sign of x
_DIRS8 = [(math.cos(i * math.tau / 8), math.sin(i * math.tau / 8)) for i in range(8)]
_DIRS8 = [(0.01 if abs(x) < 1e-9 else x, y) for x, y in _DIRS8]


def _solid_rect(spr):
    """The bounding box of the opaque part of a sprite (without the translucent cast shadow)."""
    try:
        return spr.get_bounding_rect(min_alpha=128)
    except TypeError:
        return spr.get_bounding_rect()


def _qface(fx, fy):
    """The number of the nearest of the 8 directions with the same sign of x as (fx, fy)."""
    i = round(math.atan2(fy, fx) * (8 / math.tau)) % 8
    if fx < 0:                      # the vertical directions 2 and 6 "look right" - shift to the left
        if i == 2:
            i = 3
        elif i == 6:
            i = 5
    return i


# ---- units from 3D models (game/sprites3d.py USet): choosing the animation and frame by the unit's state
_GATHER_ANIM = {'tree': 'chop', 'gold': 'mine', 'stone': 'mine', 'farm': 'farm', 'berries': 'forage',
                'hunt': 'butcher', 'fish': 'forage'}


def _female(u):
    """A female or male villager: stable for the object (by its address)."""
    return u.kind == 'villager' and (id(u) >> 5) & 1 == 1


def _uset(u, civ):
    return sprites3d.unit_set(u.look(), civ, _female(u))


def _loop_k(a, t, u):
    """A frame of a looped animation at real pace; every unit has its own phase."""
    return int((t / (a['dur'] or 1.0) + ((id(u) >> 4) % 97) / 97.0) * a['n'])


def unit_pose(u, us, t, moving):
    """(animation name, frame number) for unit u with the frame set us at game time t."""
    A = us.anims
    st = u.state
    if moving:
        name = 'walk'
        cr = u.carry_res
        if cr and u.carry >= 1 and ('carry_' + cr) in A:
            name = 'carry_' + cr
        elif getattr(u, 'flee_t', 0) > t - 1.0 and 'run' in A:
            name = 'run'
        a = A.get(name)
        if a is None:
            return 'idle', 0
        if a['n'] <= 1:
            return name, 0
        stride = a.get('stride') or 0
        if stride > 4:
            # the step is synchronized with the distance covered: anim grows by 12 per second of movement
            ph = u.anim * (u.d['speed'] * TILE / 12.0) / stride
        else:
            ph = t / (a['dur'] or 1.0)
        return name, int(ph * a['n'])
    tg = u.target
    if st == 'attack' or (st == 'gather' and isinstance(tg, Animal) and not tg.dead):
        a = A.get('attack')
        if a is None:
            return 'idle', 0
        reload = u.d.get('reload') or 2.0
        if st == 'gather':
            reload = 1.5
        D = min(a['dur'] or 1.0, max(0.35, reload * 0.95))
        e = a.get('event', 0.5)
        since = reload - u.cool
        if 0 <= since < D * (1 - e):
            ph = e + since / D
        elif u.cool < D * e:
            ph = e - u.cool / D
        else:
            ph = 0.0
        return 'attack', min(a['n'] - 1, max(0, int(ph * a['n'])))
    if st in ('heal', 'convert'):
        a = A.get('attack')
        if a is not None:
            return 'attack', _loop_k(a, t, u)
        return 'idle', 0
    if st == 'gather' and u.kind == 'villager':
        name = 'butcher' if isinstance(tg, Animal) else 'farm' if isinstance(tg, Building) else \
            _GATHER_ANIM.get(u.gather_kind, 'forage')
        a = A.get(name)
        if a is not None:
            return name, _loop_k(a, t, u)
    elif st == 'build':
        a = A.get('build')
        if a is not None:
            return 'build', _loop_k(a, t, u)
    a = A.get('idle')
    if a is not None and a['n'] > 1:
        return 'idle', _loop_k(a, t, u)          # lively idle: breathing, shifting from foot to foot (each with its own pace)
    return 'idle', 0


def _render_unit(key):
    look, col, qf, qa, qs, carry, moving = key
    if not _UCANVAS:
        _UCANVAS.append(pygame.Surface((_U_W, _U_H), pygame.SRCALPHA))
    cv = _UCANVAS[0]
    cv.fill((0, 0, 0, 0))
    gfx.draw_unit(cv, look, col, _U_OX, _U_OY, _DIRS8[qf], qa / _ANIM_Q, qs * 0.03, UNIT_K, carry, moving)
    r = cv.get_bounding_rect()
    if r.w == 0 or r.h == 0:
        spr = pygame.Surface((1, 1), pygame.SRCALPHA)
        r = pygame.Rect(_U_OX, _U_OY, 1, 1)
    else:
        spr = cv.subsurface(r).copy()
    if len(_USPR) > 6000:
        _USPR.clear()
    hit = _USPR[key] = (spr, r.x - _U_OX, r.y - _U_OY)
    return hit


_MASKS = {}


def _mask(surf, thr):
    """The mask of the opaque part of a sprite (without the cast shadow: its alpha ~ 107), cached by surface."""
    m = _MASKS.get(surf)
    if m is None:
        if len(_MASKS) > 6000:
            _MASKS.clear()
        m = _MASKS[surf] = pygame.mask.from_surface(surf, thr)
    return m


# fog: the visibility/exploration byte (0 or 1) -> alpha
_FOG_VIS = bytes([0, 255] + [255] * 254)
_FOG_EXP = bytes([0, 130] + [130] * 254)


_FISH_PICK = [None]


class Game(ScreensUI, HudUI, MenuUI, LobbyUI, DefenseUI, ControlsUI):
    def __init__(self):
        sound.pre_init()
        pygame.init()
        self.screen = pygame.display.set_mode((SCREEN_W, SCREEN_H), pygame.SCALED)
        pygame.display.set_caption(i18n.t('app.title'))
        self.clock = pygame.time.Clock()
        self.fonts = uiskin.game_fonts()      # PT Serif (numbers, names), Cormorant SC (headings), FreeSans (text)
        self.cursors = uiskin.Cursors()
        self.tcache = {}
        i18n.on_change(self.on_language)
        self.trees = [gfx.make_tree(i) for i in range(6)]
        self.node_spr = {
            'gold': [gfx.make_rocks((228, 188, 42), i, True) for i in range(4)],
            'stone': [gfx.make_rocks((150, 150, 158), i) for i in range(4)],
            'berries': [gfx.make_bush(i) for i in range(3)],
        }
        for k, d in NODE_DEFS.items():      # resources from content with their own sprite (fish)
            if d.get('sprite'):
                self.node_spr[k] = [d['sprite'](i) for i in range(3)]
        self.bspr = {}
        self.fspr = {}
        self.icons = {}
        self.state = 'menu'
        self.world = None
        self.running = True
        self.help = False
        self.menu_cfg = {}          # the lobby (game/lobby.py): player slots and match parameters
        self.cmd_page = 0
        self.cmd_key = None
        self.audio = sound.Audio()
        self.zoom = self.zoom_to = 1.0     # world scale (the mouse wheel)
        self.zoom_anchor = None
        self.wheel_acc = 0.0
        self._cv = False                    # the world is being drawn onto the canvas (w2s/s2w - in canvas coordinates)
        self._canvas = None
        self.drawn_u = []                   # (canvas rect, unit/animal, frame) - a click by the body's pixels
        self._urect = {}                    # id(unit) -> the frame's rect on the canvas (the last frame)
        self._bbc = {}                      # id(frame) -> the bounding box of opaque pixels (health bar, ellipse)
        self.apply_startup_settings()       # screens.py: cursors, full screen (settings.json)

    # ============================================================ sprites
    def pcolor(self, owner):
        w = self.world
        if w is not None and 0 <= owner < len(w.players):
            return w.players[owner].color
        return PLAYER_COLORS[owner]

    def relation(self, owner):
        """'me' | 'ally' | 'enemy' | 'gaia' - the owner's relation to the human player."""
        if owner == 0:
            return 'me'
        if owner < 0:
            return 'gaia'
        return 'ally' if self.world.allied(0, owner) else 'enemy'

    def civ_of(self, owner):
        w = self.world
        if w is not None and 0 <= owner < len(w.players):
            return w.players[owner].civ
        return 'default'

    def blook(self, kind, owner, tx, ty):
        """(model variant, shore side) of the building on the cell (tx, ty): houses - 2-3 models by the cell's hash,
        a dock - its "house" toward the shore."""
        var = 0
        if kind == 'house':
            n = sprites3d.variants(kind, self.civ_of(owner))
            if n > 1:
                h = (tx * 73856093) ^ (ty * 19349663)
                var = ((h ^ (h >> 13)) & 0x7fffffff) % n
        land = None
        if kind == 'dock' and self.world is not None:
            land = naval.dock_land(self.world, tx, ty, BUILDINGS[kind]['size'])
        return var, land

    def bsprite(self, kind, owner, stage=None, var=0, land=None):
        """(surface, ox, oy, bbox) - ox,oy: the top corner of the base inside the sprite.
        Buildings are taken from pre-rendered 3D models (game/sprites3d.py) by the owner's civilization,
        without them - procedural graphics. stage 0..2 - the construction stage (None if there is no such picture).
        var - the model variant (houses), land - the shore side (docks), see blook()."""
        col = self.pcolor(owner)
        civ = self.civ_of(owner)
        key = (kind, col, civ, stage, var, land)
        if key not in self.bspr:
            r = None
            if kind != 'farm' and not BUILDINGS[kind].get('wall'):
                r = sprites3d.building(kind, civ, col, stage, var, land)
            if r is not None:
                spr, ox, oy = r
            elif stage is not None:
                self.bspr[key] = None
                return None
            elif kind == 'farm':
                spr, ox, oy = self.farm_sprite(True, 4)
            elif BUILDINGS[kind].get('wall'):
                spr, ox, oy = self.wall_sprite(kind, owner)
            else:
                spr, ox, oy = gfx.make_building_sprite(kind, col)
            # a box without the translucent shadow (for the health bar, icons and badges)
            self.bspr[key] = (spr, ox, oy, _solid_rect(spr))
        return self.bspr[key]

    def farm_sprite(self, done, level):
        key = (done, level)
        if key not in self.fspr:
            r3 = sprites3d.farm(level if done else 0)
            if r3 is not None:
                surf, ox, oy = r3
                if not done:
                    surf = surf.copy()
                    surf.set_alpha(170)
                self.fspr[key] = (surf, ox, oy)
                return self.fspr[key]
            s = 3
            surf = pygame.Surface((s * 2 * HW + 4, s * 2 * HH + 16), pygame.SRCALPHA)
            ox, oy = s * HW + 2, 10
            gfx.draw_farm(surf, ox, oy, s, 1.0 if done else 0.0, level / 4)
            self.fspr[key] = (surf, ox, oy)
        return self.fspr[key]

    def icon(self, typ, name, owner=0, size=40):
        key = (typ, name, owner, size)
        ic = self.icons.get(key)
        if ic is not None:
            return ic
        ic = self.skin_icon(typ, name, owner, size)      # a 0 A.D. portrait (hud.py), otherwise a procedural one
        if ic is not None:
            self.icons[key] = ic
            return ic
        ic = pygame.Surface((size, size), pygame.SRCALPHA)
        if typ == 'u' and name in ANIMALS:
            gfx.draw_animal(ic, name, size / 2, size * 0.8, k=size / 26)
        elif typ == 'u':
            gfx.draw_unit(ic, name, self.pcolor(owner), size / 2, size * 0.86,
                          k=size / 27 * UNITS.get(name, {}).get('icon_k', 1.0))
        elif typ == 'b':
            spr, _, _, bb = self.bsprite(name, owner)
            spr = spr.subsurface(bb)
            sw, sh = spr.get_size()
            sc = min((size - 2) / sw, (size - 2) / sh)
            img = pygame.transform.smoothscale(spr, (max(1, int(sw * sc)), max(1, int(sh * sc))))
            if sprites3d.available():
                img.fill((16, 15, 12), special_flags=pygame.BLEND_RGB_ADD)    # the render is a bit dark for a plate
            ic.blit(img, img.get_rect(center=(size // 2, size // 2)))
        elif typ == 't':
            t = TECHS[name]
            bg = (150, 115, 40) if name in AGE_TECHS else (70, 95, 130) if not t.get('upgrade') else (60, 110, 70)
            pygame.draw.rect(ic, bg, (3, 3, size - 6, size - 6), border_radius=6)
            pygame.draw.rect(ic, shade(bg, 60), (3, 3, size - 6, size - 6), 2, border_radius=6)
            if t.get('upgrade'):
                # a line upgrade: a figure of the new unit and an up arrow
                gfx.draw_unit(ic, t['upgrade'][1], self.pcolor(owner), size * 0.45, size * 0.84, k=size / 32 * UNITS[t['upgrade'][1]].get('icon_k', 1.0))
                ax, ay = size * 0.78, size * 0.3
                pygame.draw.polygon(ic, (255, 230, 120), [(ax, ay - 7), (ax - 6, ay), (ax - 2, ay), (ax - 2, ay + 7),
                                                          (ax + 2, ay + 7), (ax + 2, ay), (ax + 6, ay)])
            else:
                f = self.fonts['l'] if len(t.get('icon', '')) <= 2 else self.fonts['b']
                img = f.render(t.get('icon', '?'), True, (255, 250, 235))
                ic.blit(img, img.get_rect(center=(size // 2, size // 2)))
        elif typ == 'x':
            self.draw_x_icon(ic, name, size)
        elif typ == 'ctl':
            controls_draw.draw_ctl_icon(ic, name, size)
        elif typ == 'n':
            r3 = sprites3d.icon_rec(name) if name in ('tree', 'gold', 'stone', 'berries') else None
            spr = r3[0] if r3 else self.trees[0] if name == 'tree' else self.node_spr[name][0]
            bb = _solid_rect(spr)
            spr = spr.subsurface(bb)
            sc = min((size - 2) / bb.w, (size - 2) / bb.h)
            img = pygame.transform.smoothscale(spr, (int(bb.w * sc), int(bb.h * sc)))
            ic.blit(img, img.get_rect(center=(size // 2, size // 2)))
        self.icons[key] = ic
        return ic

    def on_language(self, code=None):
        """Language change (Settings -> Game): fonts (Latin <-> ideographs) and all caches with text - anew."""
        uiskin.reset_fonts()
        self.fonts = uiskin.game_fonts()
        self.tcache.clear()
        self.icons.clear()                       # tech plates with letters
        for attr in ('_credits', '_nothing', '_panel_bg'):
            if hasattr(self, attr):
                setattr(self, attr, None)
        if getattr(self, 'world', None) is not None and getattr(self, 'hud_reset', None) and self.state == 'play':
            f = self.fonts
            f.setdefault('n', uiskin.font('antiqua', 18, True))
            f.setdefault('age', uiskin.font('antiqua', 18, True))
            f.setdefault('tip', uiskin.font('antiqua', 13, True))
            f.setdefault('tipb', uiskin.font('antiqua', 15, True))
        try:
            pygame.display.set_caption(i18n.t('app.title'))
        except pygame.error:
            pass

    def text(self, s, pos, font='m', color=(240, 235, 220), anchor='topleft', sh=True):
        if self.ink:                    # on parchment (hud.py): light - into dark ink, no shadow
            sh = False
            if 0.3 * color[0] + 0.59 * color[1] + 0.11 * color[2] > 140:
                color = (int(color[0] * 0.3), int(color[1] * 0.26), int(color[2] * 0.2))
        key = (s, font, color)
        img = self.tcache.get(key)
        if img is None:
            if len(self.tcache) > 1500:
                self.tcache.clear()
            img = self.fonts[font].render(s, True, color)
            self.tcache[key] = img
        r = img.get_rect(**{anchor: pos})
        if sh:
            skey = (s, font, 'sh')
            simg = self.tcache.get(skey)
            if simg is None:
                simg = self.fonts[font].render(s, True, (15, 12, 10))
                self.tcache[skey] = simg
            self.screen.blit(simg, (r.x + 1, r.y + 1))
        self.screen.blit(img, r)
        return r

    # ============================================================ new game
    def new_game(self, diff, opponents=1, ally=False, ai_human=False, map_type='land', civ='random', civs=None,
                 teams=None, colors=None, levels=None, settings=None):
        """opponents - the number of computer players (1-7); ally - player 1 is on your team (with >= 2 opponents),
        otherwise all computers are on one team against you. ai_human - the AI plays for you too (for tools).
        map_type - the map type (naval.MAP_TYPES). civ - your civilization ('random' - random);
        civs - the civilizations of all players (otherwise the computers' are random).
        teams / colors - the team (0...) and the color number (PLAYER_COLORS) of each player (lobby);
        levels - the AI level 0-5 per player (match.AI_LEVELS); settings - match parameters (game/match.py)."""
        self.last_start = dict(diff=diff, opponents=opponents, ally=ally, ai_human=ai_human, map_type=map_type,
                               civ=civ, civs=civs, teams=teams, colors=colors, levels=levels, settings=settings)
        self.make_world(**self.last_start)
        self.attach_world()

    def make_world(self, diff, opponents=1, ally=False, ai_human=False, map_type='land', civ='random', civs=None,
                   teams=None, colors=None, levels=None, settings=None):
        """Create the match's world (without preparing the screen - see attach_world)."""
        n = 1 + max(1, min(7, opponents))
        if not teams or len(teams) < n:
            teams = [0] + [1] * (n - 1)
            if ally and n >= 3:
                teams[1] = 0
        teams = list(teams)[:n]
        civs = list(civs) if civs else [civ] + ['random'] * (n - 1)
        self.world = World(diff, n, teams, map_type=map_type, civs=civs, ai_levels=levels, settings=settings)
        w = self.world
        for pid, ci in enumerate((colors or [])[:n]):
            w.players[pid].color = PLAYER_COLORS[ci]
            if pid:
                w.players[pid].name_key = 'color.' + i18n.COLOR_KEYS[ci]
        w.ais = [AI(w, pid, diff, level=(levels[pid] if levels and pid < len(levels) else None))
                 for pid in range(0 if ai_human else 1, n)]
        return w

    def attach_world(self, w=None, ui=None):
        """Prepare the screen for the world self.world (a new match or a loaded one): ground, camera, state."""
        if w is not None:
            self.world = w
        w = self.world
        self.icons.clear()
        self.iso_ox = w.H * HW
        self.iso_tw = (w.W + w.H) * HW
        self.iso_th = (w.W + w.H) * HH
        self.zoom_anchor = None
        self.zoom_to = self.zoom
        cx, cy = w.starts[0]
        self.center_on(cx * TILE, cy * TILE)
        self.selected = []
        self.placing = None
        self.groups = {}
        self.drag = None
        self.mm_drag = False
        self.mid_drag = False
        self.markers = []
        self.last_click = (0, None)
        self.last_group = (None, 0)
        self.paused = False
        self.speed = float(w.settings.get('speed', GAME_SPEED)) if getattr(w, 'settings', None) else GAME_SPEED
        self.help = False
        self.idle_idx = 0
        self.idle_rect = None
        self.drawn = []
        self.panel_hits = []
        self.build_terrain()
        self.fog_full = None
        self.fog_full_ver = -1
        self.fog_view = None
        self.mm_t = 0
        self.mm_img = None
        self.events = []
        self.cmd_page = 0
        self.cmd_key = None
        self.ctl_init()
        self.hud_reset()
        self.autosave_t = 0.0
        self.gameover_seen = False
        if ui:
            self.zoom = self.zoom_to = float(ui.get('zoom', 1.0))
            self.cam_x = ui.get('cam_x', self.cam_x)
            self.cam_y = ui.get('cam_y', self.cam_y)
            self.speed = ui.get('speed', self.speed)
            self.clamp_cam()
            self.restore_groups(ui.get('groups'))       # screens.py: Ctrl+digit groups
        self.state = 'play'

    def build_terrain(self):
        w = self.world
        MAP_W, MAP_H = w.W, w.H
        ISO_TW, ISO_TH = self.iso_tw, self.iso_th
        small = pygame.Surface((MAP_W, MAP_H))
        rnd = random.Random(5)
        depth = naval_gfx.shore_dist(w)
        # the world backing: ground type, lighter at higher levels; water - by depth (its color - the world's water)
        for y, row in enumerate(terrain_gfx.minimap_colors(w, naval_gfx.water_color, depth)):
            for x, c in enumerate(row):
                small.set_at((x, y), c)
        # the minimap - in the DE palette taking the landscape into account (game/themes.py)
        mm = pygame.Surface((MAP_W, MAP_H))
        for y, row in enumerate(terrain_gfx.minimap_colors(w, naval_gfx.water_color, depth, de=True)):
            for x, c in enumerate(row):
                mm.set_at((x, y), c)
        self.mm_base = mm
        sq = pygame.transform.smoothscale(small.convert_alpha(), (MAP_W * 24, MAP_H * 24))
        rot = pygame.transform.rotate(sq, -45)
        iso = pygame.transform.smoothscale(rot, (ISO_TW, ISO_TH))
        big = pygame.Surface((ISO_TW, ISO_TH))
        big.fill((0, 0, 0))
        big.blit(iso, (0, 0))
        # grass and water details (with the textured 0 A.D. ground - only glints on the water)
        textured = sprites3d.available() and sprites3d.terrain_tile('grass') is not None
        for _ in range(26000):
            x = rnd.uniform(0, MAP_W * TILE)
            y = rnd.uniform(0, MAP_H * TILE)
            ix, iy = to_iso(x, y, self.iso_ox)
            ix, iy = int(ix), int(iy)
            t = w.terrain[int(y // TILE)][int(x // TILE)]
            if t == 1:
                if rnd.random() < 0.3:
                    c = shade(naval_gfx.water_color(depth[int(y // TILE)][int(x // TILE)]), 22)
                    pygame.draw.line(big, c, (ix, iy), (ix + rnd.randint(4, 10), iy), 1)
            elif not textured:
                c = big.get_at((ix, iy))
                d = rnd.choice((-22, -14, 14))
                pygame.draw.line(big, shade(c, d), (ix, iy), (ix + rnd.randint(-2, 2), iy - rnd.randint(2, 5)), 1)
        for _ in range(0 if textured else 1500):
            x = rnd.uniform(0, MAP_W * TILE)
            y = rnd.uniform(0, MAP_H * TILE)
            if w.terrain[int(y // TILE)][int(x // TILE)] == 0:
                ix, iy = to_iso(x, y, self.iso_ox)
                c = rnd.choice(((230, 220, 90), (240, 240, 240), (200, 120, 200)))
                pygame.draw.circle(big, c, (int(ix), int(iy)), 1)
        tiles = terrain_gfx.load_tiles(map_assets.tile_fn(w)) if textured else None     # the match's landscape
        if tiles:
            # ground types by cell with blending by masks (game/terrain_gfx.py)
            terrain_gfx.paint_ground(big, w, self.iso_ox, tiles)
        naval_gfx.decorate(big, w, depth, self.iso_ox, rnd)
        # relief: lifting by heights and slope light; the same shift - for the fog
        relief = terrain_gfx.Relief(w, self.iso_ox, ISO_TW, ISO_TH)
        relief.apply(big)
        self.fog_rows = relief.fog_rows(ISO_TW // FOG_S, ISO_TH // FOG_S, FOG_S)
        self.terrain_surf = big.convert()
        self.water_fx = naval_gfx.WaterFX(w, self.iso_ox, depth)

    # ============================================================ camera
    # Zoom (DE, mouse wheel): the world is drawn at scale 1.0 onto a "canvas" of the size view/zoom and stretched
    # onto the screen. Canvas coordinates are the former ones (w2c); w2s/s2w are screen ones (taking zoom into account), and while
    # the world is being drawn (self._cv) - canvas coordinates, so all the drawing code does not know about the scale.
    def view_w(self):
        return SCREEN_W / self.zoom

    def view_h(self):
        return VIEW_H / self.zoom

    def clamp_cam(self):
        self.cam_x = max(0, min(self.iso_tw - self.view_w(), self.cam_x))
        self.cam_y = max(0, min(self.iso_th - self.view_h(), self.cam_y))

    def center_on(self, x, y):
        ix, iy = to_iso(x, y, self.iso_ox, self.world.z_at(x, y))
        self.cam_x = ix - self.view_w() / 2
        self.cam_y = iy - self.view_h() / 2
        self.clamp_cam()

    # Height (game/terrain.py): a world point is raised by h = world.z_at(x, y) pixels (or by an explicit h -
    # buildings stand at the base's average height). This is the only "world -> screen" path (like data.to_iso(..., z)).
    def w2c(self, x, y, h=None):
        """World -> canvas (scale 1.0; the top of the world - at TOP_H), raised by the ground height.
        The camera is an integer (like the ground, blit with int(cam)): objects and ground are on one grid."""
        if h is None:
            h = self.world.z_at(x, y)
        return x - y + self.iso_ox - int(self.cam_x), (x + y) * 0.5 - h - int(self.cam_y) + TOP_H

    def w2s(self, x, y, h=None):
        if h is None:
            h = self.world.z_at(x, y)
        z = self.zoom
        cx, cy = int(self.cam_x), int(self.cam_y)
        if z == 1.0 or self._cv:
            return x - y + self.iso_ox - cx, (x + y) * 0.5 - h - cy + TOP_H
        return (x - y + self.iso_ox - cx) * z, ((x + y) * 0.5 - h - cy) * z + TOP_H

    def s2w(self, sx, sy):
        """Screen -> the ground point under the cursor (taking relief into account)."""
        if not self._cv:
            sx, sy = self.to_canvas((sx, sy))
        return terrain.ground_at(self.world, sx + int(self.cam_x), sy - TOP_H + int(self.cam_y), self.iso_ox)

    def b2s(self, b):
        """The top corner of a building's base on the screen - at the base's average height."""
        return self.w2s(b.tx * TILE, b.ty * TILE, terrain.building_z(self.world, b))

    def to_canvas(self, pos):
        """Screen -> canvas."""
        z = self.zoom
        if z == 1.0:
            return pos[0], pos[1]
        return pos[0] / z, TOP_H + (pos[1] - TOP_H) / z

    def set_zoom(self, z, anchor=None):
        """Zoom z around the screen point anchor (the world point under it stays in place)."""
        z = max(ZOOMS[0], min(ZOOMS[-1], z))
        ax, ay = anchor if anchor is not None else (SCREEN_W / 2, TOP_H + VIEW_H / 2)
        ix = self.cam_x + ax / self.zoom
        iy = self.cam_y + (ay - TOP_H) / self.zoom
        self.zoom = 1.0 if abs(z - 1.0) < 1e-3 else z
        self.cam_x = ix - ax / self.zoom
        self.cam_y = iy - (ay - TOP_H) / self.zoom
        self.clamp_cam()

    def zoom_step(self, n, anchor=None):
        """A step along the ZOOMS ladder (n > 0 - closer). The smooth transition is in update (zoom_tick)."""
        cur = self.zoom_to
        i = min(range(len(ZOOMS)), key=lambda j: abs(ZOOMS[j] - cur))
        i = max(0, min(len(ZOOMS) - 1, i + n))
        self.zoom_to = ZOOMS[i]
        self.zoom_anchor = anchor

    def zoom_tick(self, dt):
        if self.zoom == self.zoom_to:
            return
        z, t = self.zoom, self.zoom_to
        # exponentially toward the target (~0.12 s), in the logarithm - equally fast both ways
        k = 1.0 - math.exp(-dt / 0.045)
        nz = math.exp(math.log(z) + (math.log(t) - math.log(z)) * k)
        if abs(nz - t) < 0.004:
            nz = t
        self.set_zoom(nz, self.zoom_anchor)

    def on_wheel(self, e):
        """Wheel: up/down - zoom around the cursor (DE); a sideways shift (trackpad) - scrolling."""
        if self.ctl_wheel(e):           # Ctrl+wheel - rotate the gate
            return
        if not gsettings.get('wheel_zoom', True):
            self.cam_x -= e.x * 40 / self.zoom
            self.cam_y -= e.y * 40 / self.zoom
            self.clamp_cam()
            return
        if e.x:
            self.cam_x -= e.x * 40 / self.zoom
            self.clamp_cam()
        dy = getattr(e, 'precise_y', e.y) or 0.0
        if getattr(e, 'flipped', False):
            dy = -dy
        self.wheel_acc = (self.wheel_acc if (self.wheel_acc > 0) == (dy > 0) else 0.0) + dy
        n = int(self.wheel_acc)         # a trackpad sends fractions - a step per every full "notch"
        if n:
            self.wheel_acc -= n
            self.zoom_step(n, pygame.mouse.get_pos())

    # ============================================================ loop
    def run(self):
        while self.running:
            dt = min(self.clock.tick(int(gsettings.get('fps_limit', FPS) or FPS)) / 1000.0, 0.05)
            for e in pygame.event.get():
                self.on_event(e)
            if self.state == 'menu':
                self.draw_menu()
            elif self.state == 'loading':
                self.loading_frame()        # screens.py: the loading screen (the world is built in steps)
            elif self.state == 'stats':
                self.draw_stats()           # screens.py: the achievements after the match
            else:
                self.update(dt)
                self.after_update(dt)       # screens.py: autosave
                self.draw()
            self.update_cursor()
            self.audio.update(self, dt)
            self.audio.draw_popup(self.screen)
            self.cursors.draw(self.screen)      # the software cursor - last, by the current mouse position
            pygame.display.flip()
        pygame.quit()

    def update(self, dt):
        w = self.world
        # world events per frame (sound/effects hook in here)
        self.events = w.events[:]
        w.events.clear()
        self.ctl_update()
        self.zoom_tick(dt)
        self.scroll(dt)
        if not self.paused and not self.help and w.winner is None:
            sdt = dt * self.speed
            steps = max(1, int(math.ceil(sdt / 0.034)))
            for _ in range(steps):
                w.update(sdt / steps)
        self.selected = [e for e in self.selected if e.alive]
        self.markers = [m for m in self.markers if w.time - m[3] < 1.0]

    def scroll(self, dt):
        keys = pygame.key.get_pressed()
        # the on-screen scroll speed is the same at any zoom
        sp = 1000 * dt * float(gsettings.get('scroll_speed', 1.0)) / self.zoom
        mx, my = pygame.mouse.get_pos()
        focused = pygame.mouse.get_focused() and gsettings.get('edge_scroll', True)
        if keys[pygame.K_LEFT] or (focused and mx <= 2):
            self.cam_x -= sp
        if keys[pygame.K_RIGHT] or (focused and mx >= SCREEN_W - 3):
            self.cam_x += sp
        if keys[pygame.K_UP] or (focused and my <= 2):
            self.cam_y -= sp
        if keys[pygame.K_DOWN] or (focused and my >= SCREEN_H - 3):
            self.cam_y += sp
        self.clamp_cam()

    # ============================================================ input
    def on_event(self, e):
        if e.type == pygame.QUIT:
            self.running = False
            return
        if self.audio.handle(e):
            return
        if self.state == 'menu':
            self.menu_event(e)          # menu.py: the main menu, match setup, credits
            return
        if self.state in ('loading', 'stats'):
            self.screen_event(e)        # screens.py: the loading screen, achievements
            return
        w = self.world
        if w.winner is not None and not self.gameover_seen:
            self.gameover_event(e)      # screens.py: "Victory/Defeat" -> achievements
            return
        if self.overlay_event(e):       # screens.py: F10 windows (save, load, settings...)
            return
        if e.type == pygame.KEYDOWN:
            self.on_key(e)
        elif e.type == pygame.MOUSEBUTTONDOWN:
            if self.help:
                if e.button == 1:
                    self.overlay_click(e.pos)       # hud.py: the match menu / close help
                else:
                    self.help = False
                return
            if e.button == 1:
                self.on_ldown(e.pos)
            elif e.button == 3:
                self.on_rdown(e.pos)
            elif e.button == 2:
                self.mid_drag = True
        elif e.type == pygame.MOUSEBUTTONUP:
            if e.button == 1:
                self.on_lup(e.pos)
            elif e.button == 2:
                self.mid_drag = False
        elif e.type == pygame.MOUSEWHEEL:
            self.on_wheel(e)
        elif e.type == pygame.MOUSEMOTION:
            if self.mid_drag:
                self.cam_x -= e.rel[0] / self.zoom
                self.cam_y -= e.rel[1] / self.zoom
                self.clamp_cam()
            if self.mm_drag:
                self.minimap_jump(e.pos)

    def mods(self):
        return pygame.key.get_mods()

    def on_key(self, e):
        if self.hud_key(e):             # hud.py: chat, F4 score, F5 tree, F11 clock, PgUp history
            return
        k = e.key
        if k == pygame.K_F1:
            self.help = self.help is not True
            return
        if k == pygame.K_F2:
            self.help = False if self.help == 'civ' else 'civ'
            return
        if k == pygame.K_F10:
            self.help = False if self.help == 'menu' else 'menu'
            return
        if self.ctl_key(k):             # controls.py: groups, idle, jumps, Del, Backspace, F3
            return
        if k == pygame.K_ESCAPE:        # DE: Esc does not pause (pause - F3)
            self.line_start = None
            if self.help:
                self.help = False
            elif self.placing:
                self.placing = None
            elif self.selected:
                self.selected = []
            return
        if self.defense_key(k):
            return
        if k in (pygame.K_p, pygame.K_PAUSE):
            self.paused = not self.paused
            return
        if k in (pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS, pygame.K_MINUS, pygame.K_KP_MINUS):
            i = min(range(len(SPEEDS)), key=lambda j: abs(SPEEDS[j] - self.speed))
            i += 1 if k in (pygame.K_PLUS, pygame.K_EQUALS, pygame.K_KP_PLUS) else -1
            self.speed = SPEEDS[max(0, min(len(SPEEDS) - 1, i))]
            return
        if k == pygame.K_SPACE:
            if self.selected:
                self.jump_to(*self.selected[0].center())
            return
        name = pygame.key.name(k).upper()
        if len(name) == 1 and name in HOTKEYS:
            for bt in self.get_buttons():
                if bt['key'] == name:
                    self.press_button(bt)
                    return

    def in_view(self, pos):
        return self.hud_view(pos)       # the world is visible between the bottom panels too (hud.py)

    # ---- minimap (diamond)
    def mm_rect(self):
        return MM_RECT

    def mm_to_world(self, pos):
        r = self.mm_rect()
        w = self.world
        ix = (pos[0] - r.left) / r.w * self.iso_tw
        iy = (pos[1] - r.top) / r.h * self.iso_th
        x, y = from_iso(ix, iy, self.iso_ox)
        return max(0, min(w.W * TILE - 1, x)), max(0, min(w.H * TILE - 1, y))

    def world_to_mm(self, x, y):
        r = self.mm_rect()
        ix, iy = to_iso(x, y, self.iso_ox)
        return r.left + ix / self.iso_tw * r.w, r.top + iy / self.iso_th * r.h

    def mm_hit(self, pos):
        r = self.mm_rect()
        dx = abs(pos[0] - r.centerx) / (r.w / 2)
        dy = abs(pos[1] - r.centery) / (r.h / 2)
        return dx + dy <= 1.0

    def minimap_jump(self, pos):
        self.center_on(*self.mm_to_world(pos))

    # ---- mouse
    def on_ldown(self, pos):
        if self.hud_click(pos):         # hud.py: top, panels, minimap, windows, signal
            return
        if self.order_mode:
            self.order_click(pos)       # controls.py: patrol, guard, follow, attack-move / attack ground
            return
        if self.placing:
            if not self.place_down(pos):
                self.try_place(pos)
            return
        self.drag = pos

    def on_lup(self, pos):
        self.mm_drag = False
        if self.line_start is not None:
            self.place_up(pos)
            return
        if self.drag is None:
            return
        w = self.world
        x0, y0 = self.drag
        self.drag = None
        m = self.mods()
        shift = m & pygame.KMOD_SHIFT
        ctrl = m & (pygame.KMOD_CTRL | pygame.KMOD_META)
        if abs(pos[0] - x0) < 5 and abs(pos[1] - y0) < 5:
            e = self.entity_at(pos)
            now = pygame.time.get_ticks()
            dbl = now - self.last_click[0] < 350 and e is self.last_click[1]
            self.last_click = (now, e)
            self.click_select(e, shift, ctrl, dbl)      # controls.py: Shift/Ctrl - add/remove, double - a line
            if e is not None:
                w.emit('select', *e.center(), 0, e.kind)
        else:
            r = pygame.Rect(min(x0, pos[0]), min(y0, pos[1]), abs(pos[0] - x0), abs(pos[1] - y0))
            first = self.box_select(r, shift)           # controls.py: top to bottom, up to 60
            if first is not None:
                w.emit('select', first.x, first.y, 0, first.kind)

    def on_screen(self, u):
        sx, sy = self.w2s(u.x, u.y)
        return 0 <= sx < SCREEN_W and TOP_H <= sy < SCREEN_H - PANEL_H

    def entity_at(self, pos):
        w = self.world
        spos = pos
        pos = self.to_canvas(pos)       # comparison with figures and sprites - in canvas coordinates (scale 1)
        # units and animals - by the opaque pixels of the drawn frame (DE: a click on the body), front to back;
        # an own unit in an overlap outweighs a foreign one (09 - #41-45)
        px, py = int(pos[0]), int(pos[1])
        enemy = None
        for rect, u, surf in reversed(self.drawn_u):
            if rect.collidepoint(pos):
                try:
                    a = surf.get_at((px - rect.x, py - rect.y))[3]
                except IndexError:
                    continue
                if a > 120:
                    if u.owner == 0:
                        return u
                    if enemy is None:
                        enemy = u
        if enemy is not None:
            return enemy
        best, bd = None, 1e9
        arow = w.amat[0]
        urect = self._urect
        for u in w.units + w.animals:
            if not arow[u.owner] and not w.visible_px(u.x, u.y):
                continue
            sx, sy = self.w2c(u.x, u.y)
            us = None if isinstance(u, Animal) else _uset(u, self.civ_of(u.owner))
            if us is not None:
                # margin: a "radius x height" column around the feet, but no farther than +-4 px from the drawn frame
                fr = urect.get(id(u))
                if fr is not None:
                    fr = pygame.Rect(sx + fr[0], sy + fr[1], fr[2], fr[3])
                    if not fr.inflate(8, 8).collidepoint(pos):
                        continue
                    sx = fr.centerx
                h = us.bh + 4
                up = sy - pos[1]
                hw = max(u.radius * 1.1 + 4, h * 0.28)
                if fr is not None or (-8 <= up <= h + 4 and abs(pos[0] - sx) <= hw):
                    d = abs(pos[0] - sx) + abs(up - h * 0.5) * 0.3
                    if u.owner != 0:
                        d += 1e5        # DE: an own unit in an overlap always outweighs a foreign one
                    if d < bd:
                        bd, best = d, u
                continue
            d = math.hypot(sx - pos[0], sy - 10 - pos[1])
            if d < u.radius * 1.2 + 8:
                if u.owner != 0:
                    d += 1e5
                if d < bd:
                    bd, best = d, u
        if best:
            return best
        # sprites of buildings and resources - front to back, by pixels
        for rect, ent, surf in reversed(self.drawn):
            if rect.collidepoint(pos):
                lx, ly = int(pos[0] - rect.x), int(pos[1] - rect.y)
                if surf.get_at((lx, ly))[3] > 120:      # a translucent shadow does not catch a click
                    return ent
        wx, wy = self.s2w(*spos)
        tx, ty = int(wx // TILE), int(wy // TILE)
        if 0 <= tx < w.W and 0 <= ty < w.H:
            b = w.floor[ty][tx]
            if b is not None and b.seen:
                return b
        return None

    def on_rdown(self, pos):
        if self.order_mode:             # right click cancels the order mode
            self.order_mode = None
            self.order_pts = []
            return
        if self.placing:
            self.placing = None
            self.line_start = None
            return
        if self.hud_rclick(pos):        # hud.py: right click on the minimap - an order, on the panels - nothing
            return
        wx, wy = self.s2w(*pos)
        self.command(wx, wy, self.entity_at(pos))

    def command(self, wx, wy, target):
        """Right click on the map / minimap. Shift - an order into the queue (waypoints, chains of tasks)."""
        units = [u for u in self.selected if isinstance(u, Unit) and u.owner == 0 and u.alive]
        queue = self.queue_mode()
        if not queue:
            for u in units:
                orders.clear(u)
        self._queue = queue
        try:
            self._command(units, wx, wy, target)
        finally:
            self._queue = False

    def _command(self, units, wx, wy, target):
        w = self.world
        o = self.o
        if units and naval.ui_command(self, w, units, wx, wy, target):
            return
        # units with their own order (the trade cart): d['command'](unit, world, target, x, y)
        special = [u for u in units if u.d.get('command')]
        if special:
            for u in special:
                u.d['command'](u, w, target, wx, wy)
            units = [u for u in units if not u.d.get('command')]
            if not units:
                self.markers.append((wx, wy, (255, 220, 90), w.time))
                w.emit('command', wx, wy, 0, 'move')
                return
        if units:
            if isinstance(target, Animal):
                for u in units:
                    if target.den is not None:          # a wolf: not game - only to be hit
                        o(u, ('attack', target) if not target.dead else ('move', target.x, target.y))
                    elif u.kind == 'villager':
                        o(u, ('gather', target))
                    elif not target.dead and (target.kind != 'sheep' or w.hostile(0, target.owner)):
                        o(u, ('attack', target))
                    else:
                        o(u, ('move', target.x, target.y))
                self.markers.append((wx, wy, (120, 255, 120), w.time))
                w.emit('command', wx, wy, 0, 'gather')
                return
            if self.relic_command(units, target, wx, wy):       # monks: a relic (game/relics.py)
                return
            if self.repair_command(units, target, wx, wy):      # controls.py: repair by villagers
                return
            if self.garrison_command(units, target, wx, wy):
                return
            monks = [u for u in units if u.d.get('monk')]
            if monks and isinstance(target, Unit) and target.owner >= 0 and w.allied(0, target.owner) \
                    and target.hp < target.max_hp:
                for u in monks:
                    o(u, ('heal', target))
                self.markers.append((wx, wy, (120, 255, 120), w.time))
                w.emit('command', wx, wy, 0, 'heal')
                units = [u for u in units if not u.d.get('monk')]
                if not units:
                    return
            if target is not None and w.hostile(0, target.owner):
                for u in units:
                    o(u, ('attack', target))
                self.markers.append((wx, wy, (255, 80, 60), w.time))
                w.emit('command', wx, wy, 0, 'attack')
                return
            vils = [u for u in units if u.kind == 'villager']
            rest = [u for u in units if u.kind != 'villager']
            if isinstance(target, Node) and vils:
                for u in vils:
                    o(u, ('gather', target))
                self.markers.append((wx, wy, (120, 255, 120), w.time))
                self.group_move(rest, wx, wy)
                w.emit('command', wx, wy, 0, 'gather')
                return
            if isinstance(target, Building) and target.owner == 0 and vils:
                if not target.complete:
                    for u in vils:
                        o(u, ('build', target))
                elif target.kind == 'farm':
                    o(vils[0], ('gather', target))
                    self.group_move(vils[1:], wx, wy)
                elif target.d.get('drop'):
                    for u in vils:
                        if u.carry > 0 and u.carry_res in target.d['drop']:
                            o(u, ('return', target))
                        else:
                            o(u, ('move', wx, wy))
                else:
                    self.group_move(vils, wx, wy)
                self.markers.append((wx, wy, (120, 255, 120), w.time))
                self.group_move(rest, wx, wy)
                w.emit('command', wx, wy, 0, 'work')
                return
            self.group_move(units, wx, wy)
            self.markers.append((wx, wy, (255, 255, 255), w.time))
            w.emit('command', wx, wy, 0, 'move')
        else:
            # the rally point of all selected buildings; Shift - one more point (DE: several rally points)
            for b in [s for s in self.selected if isinstance(s, Building) and s.owner == 0 and s.d.get('trains')]:
                new = target if target is not None else (wx, wy)
                if self._queue and b.rally is not None:
                    prev = b.rally if isinstance(b.rally, tuple) else b.rally.center()
                    b.rally_pts = (getattr(b, 'rally_pts', None) or []) + [prev]
                else:
                    b.rally_pts = None
                b.rally = new
                self.markers.append((wx, wy, (255, 220, 90), w.time))

    def group_move(self, units, wx, wy):
        self.form_move(units, wx, wy)           # controls.py: formation and shared speed

    # ---- construction
    def place_tile(self, pos):
        wx, wy = self.s2w(*pos)
        s = BUILDINGS[self.placing]['size']
        return int(round(wx / TILE - s / 2)), int(round(wy / TILE - s / 2))

    def try_place(self, pos):
        w = self.world
        p = w.players[0]
        kind = self.placing
        tx, ty = self.place_tile(pos)
        if not w.can_place(kind, tx, ty, 0):
            w.msg(i18n.t('msg.cannot_build_here'), (255, 150, 90))
            return
        if not p.pay(p.cost_of('bld', kind)):
            w.msg(i18n.t('msg.not_enough_resources'), (255, 150, 90))
            self.placing = None
            return
        b = w.place_building(kind, 0, tx, ty)
        shift = self.mods() & pygame.KMOD_SHIFT
        for u in self.selected:
            if isinstance(u, Unit) and u.kind == 'villager' and u.owner == 0:
                # Shift: constructions - in the order of laying (a queue), the first one - at once
                q = bool(shift) and (u.state == 'build' or any(it[0] == 'build' for it in (u.orders or ())))
                orders.issue(u, w, ('build', b), queue=q)
        if not (self.mods() & pygame.KMOD_SHIFT) or not p.afford(p.cost_of('bld', kind)):
            self.placing = None

    # ---- buttons
    # The 5x3 command grid (hotkeys HOTKEYS). If there are more items than fit, the last
    # cell is a "page" button (it flips), and the permanent buttons (stop) stand before it on every page.
    GRID = 15

    def layout_buttons(self, items, fixed=()):
        """items / fixed - lists of dict(icon, act, ok, tip[, slot]). Returns buttons with rect and key (hud.grid_layout)."""
        return self.grid_layout(items, fixed)

    def get_buttons(self):
        w = self.world
        p = w.players[0]
        sel = [e for e in self.selected if e.alive and e.owner == 0]
        if not sel:
            return []
        # the selection changed - flip from the first page
        key = (sel[0].kind, isinstance(sel[0], Unit))
        if key != self.cmd_key:
            self.cmd_key = key
            self.cmd_page = 0
        units = [e for e in sel if isinstance(e, Unit)]
        items = []
        if units:
            if self.army_selection(units):
                # army: the DE grid (orders, stances, stop, formations) - controls.py
                extra = naval.unit_buttons(w, units)
                packs = [u for u in units if u.d.get('pack')]
                if packs:
                    goal = not all(u.packed for u in packs)
                    extra.append(dict(icon=('x', 'treb_pack' if goal else 'treb_up'),
                                      act=('pack', goal), ok=True,
                                      tip=[i18n.t('hud.pack') if goal else i18n.t('hud.unpack'), {},
                                           i18n.t('hud.pack_desc') if goal else i18n.t('hud.unpack_desc')]))
                return self.army_buttons(units, extra)
            vil = any(u.kind == 'villager' for u in units)
            if vil:
                items += self.villager_items(p)     # hud.py: the "economy" / "military" pages (DE)
                if self.build_page:
                    return self.layout_buttons(items)
            items += naval.unit_buttons(w, units)
            packs = [u for u in units if u.d.get('pack')]
            if packs:
                # trebuchet: pack (to move) / unpack (to fire)
                items.append(dict(icon=('x', 'treb_pack'), act=('pack', True), ok=True,
                                  tip=[i18n.t('hud.pack'), {}, i18n.t('hud.pack_desc')]))
                items.append(dict(icon=('x', 'treb_up'), act=('pack', False), ok=True,
                                  tip=[i18n.t('hud.unpack'), {}, i18n.t('hud.unpack_desc')]))
            stop = dict(icon=('stop', None), act=('stop', None), ok=True, tip=[i18n.t('hud.stop'), {}, i18n.t('hud.stop_desc')])
            if vil:
                stop['slot'] = 9
            return self.layout_buttons(items, [stop])
        b = sel[0]
        if not isinstance(b, Building) or not b.complete:
            return []
        for base_kind in b.d.get('trains', []):
            uk = p.current(base_kind)
            if not p.allows(base_kind, b.kind) or not p.allows(uk):
                continue        # foreign unique units and what the civilization cannot use - not shown
            d = UNITS[uk]
            cost = p.cost_of('unit', uk)
            can, why = w.unit_state(p, uk)
            locked = not can
            tip = [d['name'], cost, d['desc'], ('dim', i18n.t('hud.shift_5'))]
            if locked:
                tip.append(('red', why))
            items.append(dict(icon=('u', uk), act=('train', b, uk), ok=not locked and p.afford(cost) and len(b.queue) < 15,
                              tip=tip))
        for tk in b.d.get('techs', []):
            if tk in p.techs or not p.allows(tk):
                continue
            if tk in AGE_TECHS and TECHS[tk]['age'] != p.age and tk not in p.researching:
                continue
            t = TECHS[tk]
            # the next step of a chain (req) appears when the previous one is researched or being researched
            if any(r not in p.techs and r not in p.researching for r in as_tuple(t.get('req', ()))):
                continue
            cost = p.cost_of('tech', tk)
            ok, why = w.tech_state(p, tk)
            tip = [t['name'], cost, t['desc']]
            if not ok:
                tip.append(('red', why))
            items.append(dict(icon=('t', tk), act=('research', b, tk), ok=ok and p.afford(cost), tip=tip))
        items += self.defense_buttons(b)
        extra = b.d.get('buttons')     # buttons from content: fn(game, building, player) -> items (market, mill)
        if extra:
            items += extra(self, b, p)
        return self.layout_buttons(self.building_slots(b, p, items))    # hud.py: button places as in DE

    def press_button(self, bt):
        self.audio.click()
        w = self.world
        p = w.players[0]
        act = bt['act']
        if self.army_press(act) or self.defense_press(act):     # controls.py: stop, stances, formations, orders
            return
        if act[0] == 'page':
            self.cmd_page += 1
        elif act[0] == 'call':
            act[1](self)
        elif act[0] == 'place':
            d = BUILDINGS[act[1]]
            if w.build_age(p, act[1]) > p.age:
                w.msg(i18n.t('msg.need_age', age=AGE_NAMES[d['age']]), (255, 150, 90))
            elif not p.afford(p.cost_of('bld', act[1])):
                w.msg(i18n.t('msg.not_enough_resources'), (255, 150, 90))
            else:
                self.placing = act[1]
        elif act[0] == 'unload':
            naval.press_unload(w, [u for u in self.selected if isinstance(u, Unit) and u.owner == 0])
        elif act[0] == 'train':
            b, uk = act[1], p.current(act[2])
            can, why = w.unit_state(p, uk)
            if not can:
                w.msg(why, (255, 150, 90))
                return
            n = 5 if self.mods() & pygame.KMOD_SHIFT else 1
            for _ in range(n):
                if len(b.queue) >= 15:
                    break
                if not p.pay(p.cost_of('unit', uk)):
                    w.msg(i18n.t('msg.not_enough_resources'), (255, 150, 90))
                    break
                b.queue.append(('unit', uk))
        elif act[0] == 'research':
            b, tk = act[1], act[2]
            ok, why = w.tech_state(p, tk)
            if not ok:
                w.msg(why, (255, 150, 90))
            elif not p.pay(p.cost_of('tech', tk)):
                w.msg(i18n.t('msg.not_enough_resources'), (255, 150, 90))
            else:
                b.queue.append(('tech', tk))
                p.researching.add(tk)

    # ============================================================ drawing
    _PRELOAD_EVERY = 1.5

    def preload_units(self):
        """Sheets of sprites of kinds that players can train right now - into background preloading (without a hitch on
        a unit's first appearance). Once per _PRELOAD_EVERY seconds of real time; conversion into surfaces -
        sprites3d.pump() no longer than 2 ms per frame."""
        now = time.perf_counter()
        if now >= getattr(self, '_preload_t', 0.0):
            self._preload_t = now + self._PRELOAD_EVERY
            w = self.world
            seen = set()
            for b in w.buildings:
                key = (b.owner, b.kind)
                if key in seen or not b.complete or b.owner < 0 or b.owner >= len(w.players):
                    continue
                seen.add(key)
                p = w.players[b.owner]
                civ = p.civ
                for base_kind in b.d.get('trains', ()):
                    uk = p.current(base_kind)
                    if not p.allows(base_kind, b.kind) or not p.allows(uk):
                        continue
                    sprites3d.request(uk, civ)
                    if uk == 'villager':
                        sprites3d.request(uk, civ, True)
        sprites3d.pump(0.002)

    def draw(self):
        self.screen.fill((0, 0, 0))
        if sprites3d.units_index() is not None:
            self.preload_units()
        self.draw_world()
        self.draw_top()
        self.draw_panel()
        controls_draw.draw_panel_overlay(self)     # signals on the minimap, the order-mode hint
        self.draw_messages()
        self.draw_overlays()            # hud.py: windows (objectives, chat, diplomacy, tree), help, the match menu
        if self.world.winner is not None:
            self.draw_gameover()
        elif self.paused:
            self.text(i18n.t('keys.pause').upper(), (SCREEN_W // 2, TOP_H + 60), 'xl', (255, 240, 200), anchor='center')

    def diamond(self, tx, ty, w, h):
        return [self.w2s(tx * TILE, ty * TILE), self.w2s((tx + w) * TILE, ty * TILE),
                self.w2s((tx + w) * TILE, (ty + h) * TILE), self.w2s(tx * TILE, (ty + h) * TILE)]

    def draw_world(self):
        """The world under the panels. At a scale != 1 - onto a canvas view/zoom (in the former coordinates), then stretched."""
        z = self.zoom
        mp = pygame.mouse.get_pos()
        if z == 1.0:
            self._draw_world_at(self.screen, SCREEN_W, SCREEN_H - TOP_H, mp)
        else:
            cw = max(1, int(round(SCREEN_W / z)))
            ch = max(1, int(round((SCREEN_H - TOP_H) / z)))
            cv = self._canvas
            if cv is None or cv.get_size() != (cw, TOP_H + ch):
                cv = self._canvas = pygame.Surface((cw, TOP_H + ch)).convert(self.screen)
            real = self.screen
            self.screen, self._cv = cv, True
            try:
                if self.iso_tw < cw or self.iso_th < ch:     # the map is smaller than the view - the margins around are black
                    cv.fill((0, 0, 0))
                self._draw_world_at(cv, cw, ch, self.to_canvas(mp))
            finally:
                self.screen, self._cv = real, False
            dst = real.subsurface((0, TOP_H, SCREEN_W, SCREEN_H - TOP_H))
            # zooming out - with smoothing (otherwise it shimmers); zooming in - with smoothing too, it is cheap (the canvas is smaller than the screen).
            # Stretch exactly by a factor z (otherwise near the screen edge objects drift by <= 1.2 px from w2s)
            sw, sh = int(round(cw * z)), int(round(ch * z))
            if (sw, sh) == dst.get_size():
                pygame.transform.smoothscale(cv.subsurface((0, TOP_H, cw, ch)), dst.get_size(), dst)
            else:
                dst.fill((0, 0, 0))
                dst.blit(pygame.transform.smoothscale(cv.subsurface((0, TOP_H, cw, ch)), (sw, sh)), (0, 0))
        # the selection box - in screen coordinates, over the stretched world
        if self.drag:
            r = pygame.Rect(min(self.drag[0], mp[0]), min(self.drag[1], mp[1]),
                            abs(mp[0] - self.drag[0]), abs(mp[1] - self.drag[1]))
            if r.w > 4 or r.h > 4:
                self.screen.set_clip(pygame.Rect(0, TOP_H, SCREEN_W, SCREEN_H - TOP_H))
                pygame.draw.rect(self.screen, (240, 240, 240), r, 1)
                self.screen.set_clip(None)

    def _draw_world_at(self, scr, vw, wh, cmp):
        """The world on scr: view width vw, height wh (below TOP_H); cmp - the cursor in scr coordinates."""
        w = self.world
        self._vw, self._vh = vw, wh
        view = pygame.Rect(0, TOP_H, vw, wh)
        scr.set_clip(view)
        scr.blit(self.terrain_surf, (0, TOP_H), pygame.Rect(int(self.cam_x), int(self.cam_y), vw, wh))
        self.water_fx.draw(scr, int(self.cam_x), int(self.cam_y), TOP_H, vw, wh, w.time)
        exp = w.explored
        vx0, vy0, vx1, vy1 = -80, TOP_H - 140, vw + 80, TOP_H + wh + 60
        self.drawn = []
        self.drawn_u = []
        self._urect = {}

        def onscr(sx, sy):
            return vx0 < sx < vx1 and vy0 < sy < vy1

        # traces on the ground
        for d in w.decals:
            if d[0] == 'rubble':
                tx, ty, s = d[1], d[2], d[3]
                sx, sy = self.w2s((tx + s / 2) * TILE, (ty + s / 2) * TILE)
                if not onscr(sx, sy):
                    continue
                if self.draw_rubble(d, sx, sy):
                    continue
                rr = random.Random(tx * 99 + ty)
                for _ in range(s * s * 6):
                    x, y = self.w2s((tx + rr.random() * s) * TILE, (ty + rr.random() * s) * TILE)
                    pygame.draw.circle(scr, (92, 86, 78) if rr.random() < 0.6 else (60, 45, 35), (x, y),
                                       rr.randint(2, 5))
            elif d[0] == 'stump':
                _, tx, ty, _, _ = d
                x, y = self.w2s((tx + 0.5) * TILE, (ty + 0.5) * TILE)
                if not onscr(x, y):
                    continue
                st = sprites_extra.stump(tx, ty, min(255, (60 - (w.time - d[4])) * 64))
                if st is not None:
                    sprites_extra.blit(scr, st, x, y)
                else:
                    pygame.draw.ellipse(scr, (95, 70, 40), (x - 6, y - 3, 12, 7))
                    pygame.draw.ellipse(scr, (160, 125, 80), (x - 4, y - 2, 8, 4))
            elif d[0] == 'blast':
                _, x, y, owner, t = d
                a = w.time - t
                if a < 1.2 and w.visible_px(x, y):
                    sx, sy = self.w2s(x, y)
                    if sprites_extra.group('blast') is not None:
                        continue                # explosion frames - over objects, after projectiles
                    r = 10 + a * 60
                    pygame.draw.ellipse(scr, (255, 200, 90) if a < 0.3 else (230, 230, 220),
                                        (sx - r, sy - r / 2, 2 * r, r), 3)
                    if a < 0.4:
                        pygame.draw.circle(scr, (255, 150, 40), (int(sx), int(sy - 10)), int(18 - a * 30))
            elif d[0] == 'body':
                x, y, owner, t = d[1], d[2], d[3], d[4]
                if len(d) > 5 and w.visible_px(x, y) and self.draw_body(d[5], x, y, owner, w.time - t, onscr):
                    continue
                if w.time - t < 20 and w.visible_px(x, y):
                    sx, sy = self.w2s(x, y)
                    pygame.draw.ellipse(scr, shade(self.pcolor(owner), -60), (sx - 8, sy - 3, 16, 6))
                    pygame.draw.circle(scr, (225, 215, 195), (int(sx + 7), int(sy - 1)), 2)
        # farms - the ground layer
        sel = set(id(e) for e in self.selected)
        for b in w.buildings:
            if b.kind != 'farm' or not b.seen:
                continue
            sx, sy = self.b2s(b)
            if not onscr(sx, sy + 48):
                continue
            level = max(0, min(4, int(math.ceil(b.amount / max(FARM_FOOD + 75, b.amount) * 4)))) if b.complete else 0
            spr, ox, oy = self.farm_sprite(b.complete, level)
            scr.blit(spr, (sx - ox, sy - oy))
            if id(b) in sel:
                pygame.draw.polygon(scr, (255, 255, 255), self.diamond(b.tx, b.ty, b.w, b.h), 1)
            if not b.complete:
                self.hpbar(sx - 30, sy + 40, 60, b.progress, 0)
        # objects by depth
        items = []
        W = w.W
        arow = w.amat[0]
        for n in w.nodes:
            if not n.alive or not exp[n.ty * W + n.tx]:
                continue
            sx, sy = self.w2s((n.tx + 0.5) * TILE, (n.ty + 0.5) * TILE)
            if onscr(sx, sy):
                items.append(((n.tx + n.ty + 1) * TILE, 0, n, sx, sy))
        for b in w.buildings:
            if b.walk or not b.seen:
                continue
            sx, sy = self.b2s(b)
            if -300 < sx < vw + 300 and TOP_H - 300 < sy < TOP_H + wh:
                items.append(((b.tx + b.ty + (b.w + b.h) / 2) * TILE, 1, b, sx, sy))
        for u in w.units:
            if not arow[u.owner] and not w.visible_px(u.x, u.y):
                continue
            sx, sy = self.w2s(u.x, u.y)
            if onscr(sx, sy):
                items.append((u.x + u.y, 2, u, sx, sy))
        for a in w.animals:
            if not arow[a.owner] and not w.visible_px(a.x, a.y):
                continue
            sx, sy = self.w2s(a.x, a.y)
            if onscr(sx, sy):
                items.append((a.x + a.y - (40 if a.dead else 0), 3, a, sx, sy))
        for r in getattr(w, 'relics', ()):      # relics on the ground (game/relics.py) - where explored
            if r.carrier is None and r.holder is None and exp[r.ty * W + r.tx]:
                sx, sy = self.w2s(r.x, r.y)
                if onscr(sx, sy):
                    items.append((r.x + r.y, 0, r, sx, sy))
        for c in w.cliffs:                  # cliffs - rock boulders by cells (game/terrain.py)
            if exp[c[1] * W + c[0]]:
                sx, sy = self.w2s((c[0] + 0.5) * TILE, (c[1] + 0.5) * TILE)
                if onscr(sx, sy):
                    items.append(((c[0] + c[1] + 1) * TILE, 0, c, sx, sy))
        items.sort(key=_DEPTH_KEY)
        drawn_units = []           # (how many objects are already in self.drawn, (sprite, x, y), color) - for silhouettes
        for _, typ, e, sx, sy in items:
            if typ == 0:
                if e.__class__ is tuple:
                    self.draw_cliff(e, sx, sy)
                    continue
                if e.__class__ is relics.Relic:
                    relics.draw_ground(self, e, sx, sy)
                    continue
                self.draw_node(e, sx, sy, id(e) in sel)
            elif typ == 1:
                self.draw_building(e, sx, sy, id(e) in sel)
            elif typ == 2:
                self._ublit = None
                self.draw_unit_w(e, sx, sy, id(e) in sel)
                if e.relic is not None:
                    relics.draw_carried(self, e, sx, sy)
                if self._ublit is not None:
                    drawn_units.append((len(self.drawn), self._ublit, self.pcolor(e.owner)))
            else:
                if id(e) in sel:
                    rw = e.radius * 2.4 + 8
                    pygame.draw.ellipse(self.screen, (255, 255, 255), (sx - rw / 2, sy - rw / 4, rw, rw / 2), 1)
                fx, fy = e.face
                col = self.pcolor(e.owner) if e.owner >= 0 else None
                us = sprites3d.unit_set('animal_' + e.kind, None)
                if us is not None:
                    dd = us.face(fx, fy)
                    if e.dead:
                        a = us.anims.get('death')
                        if a is not None:
                            k = min(a['n'] - 1, int((w.time - e.dead_t) / (a['dur'] or 1.0) * a['n']))
                            if k >= a['n'] - 1 and self.draw_carcass(e, fx, fy, sx, sy):
                                continue
                            spr, ax, ay = us.frame(us.index('death', dd, max(0, k)), None)
                            scr.blit(spr, (int(sx) - ax, int(sy) - ay))
                            continue
                    else:
                        name, k = unit_pose(e, us, w.time, e.state == 'move' and bool(e.path or e.dest))
                        spr, ax, ay = us.frame(us.index(name, dd, k), col)
                        scr.blit(spr, (int(sx) - ax, int(sy) - ay))
                        self.note_unit(e, spr, int(sx) - ax, int(sy) - ay, sx, sy)
                        continue
                if e.dead and self.draw_carcass(e, fx, fy, sx, sy):
                    continue
                r3 = None if e.dead else (sprites3d.animal(e.kind, id(e) >> 4, e.face, col) or
                                          map_assets.animal(e.kind, id(e) >> 4, e.face))
                if r3 is not None:
                    spr, ox, oy = r3
                    scr.blit(spr, (int(sx - ox), int(sy - HH - oy)))
                    continue
                gfx.draw_animal(self.screen, e.kind, sx, sy, (fx - fy, 0), e.anim, e.state == 'move', e.dead,
                                col, UNIT_K)
        if drawn_units:
            self.draw_silhouettes(drawn_units)
        # projectiles
        for pr in w.projectiles:
            if pr.delay > 0 or not w.visible_px(pr.x, pr.y):
                continue
            tx, ty = pr.aim()
            total = math.hypot(tx - pr.sx, ty - pr.sy) or 1
            left = math.hypot(tx - pr.x, ty - pr.y)
            prog = max(0.0, min(1.0, 1 - left / max(total, left)))
            arc = math.sin(prog * math.pi) * min(40, total * 0.2)
            x, y = self.w2s(pr.x, pr.y)
            x2, y2 = self.w2s(tx, ty)
            dx, dy = x2 - x, y2 - y
            d = math.hypot(dx, dy) or 1
            shape = getattr(pr, 'shape', None)
            if arc > 3 and not getattr(pr, 'ball', False) and shape not in ('stone', 'ball'):
                # the arrow's shadow on the ground (DE: p_arrow_shadow) - a short dark stroke under the projectile
                ux, uy = dx / d * 4, dy / d * 4
                pygame.draw.line(scr, (52, 44, 28), (x - ux, y - uy), (x + ux, y + uy), 2)
            y -= arc + 10
            if self.draw_projectile(pr, shape, x, y, prog, total, tx, ty):
                continue
            if getattr(pr, 'ball', False) or shape in ('stone', 'ball'):
                # a mangonel/trebuchet stone, a cannon or ship cannonball
                r = 4 if shape == 'stone' else (3 if getattr(pr, 'ball', False) else 2)
                pygame.draw.circle(scr, (60, 55, 50) if shape != 'stone' else (120, 112, 100), (int(x), int(y)), r)
                continue
            L = 12 if pr.javelin else 7 if shape == 'bolt' else 9
            pygame.draw.line(scr, (60, 40, 25), (x - dx / d * L, y - dy / d * L), (x, y), 2)
            pygame.draw.line(scr, (230, 230, 230), (x - dx / d * 2, y - dy / d * 2), (x, y), 1)
        # explosions - over objects
        if sprites_extra.group('blast') is not None:
            for d in w.decals:
                if d[0] == 'blast' and w.time - d[4] < 1.2 and w.visible_px(d[1], d[2]):
                    sx, sy = self.w2s(d[1], d[2])
                    if onscr(sx, sy):
                        sprites_extra.blit(scr, sprites_extra.blast(w.time - d[4]), sx, sy)
        self.draw_fog()
        # health bars
        for u in w.units:
            if (id(u) in sel or u.hp < u.max_hp) and (arow[u.owner] or w.visible_px(u.x, u.y)):
                sx, sy = self.w2s(u.x, u.y)
                if onscr(sx, sy):
                    self.hpbar(sx - 12, sy - self.unit_top(u), 24, u.hp / u.max_hp, u.owner)
        for b in w.buildings:
            if b.walk or not ((id(b) in sel or b.hp < b.max_hp) and b.seen and b.complete):
                continue
            sx, sy = self.b2s(b)
            spr, ox, oy, bb = self.bsprite_for(b)
            bw = min(90, max(b.w, b.h) * 30)
            self.hpbar(sx - bw / 2, max(TOP_H + 2, sy - oy + bb.top - 8), bw, b.hp / b.max_hp, b.owner)
        # order markers
        for (mx, my, c, t) in self.markers:
            a = (w.time - t) / 1.0
            r = int(12 * (1 - a)) + 3
            sx, sy = self.w2s(mx, my)
            pygame.draw.ellipse(scr, c, (sx - r, sy - r / 2, 2 * r, r), 2)
        # rally point
        for s in self.selected:
            if isinstance(s, Building) and s.owner == 0 and s.rally is not None:
                r = s.rally
                rx, ry = r if isinstance(r, tuple) else r.center()
                a = self.w2s(*s.center())
                b2 = self.w2s(rx, ry)
                pygame.draw.line(scr, (255, 230, 120), a, b2, 1)
                pygame.draw.line(scr, (80, 60, 40), b2, (b2[0], b2[1] - 18), 2)
                pygame.draw.polygon(scr, self.pcolor(0), [(b2[0], b2[1] - 18), (b2[0] + 11, b2[1] - 14),
                                                             (b2[0], b2[1] - 10)])
        controls_draw.draw_world_overlay(self)     # group numbers, route flags, patrol, signals
        # building placement
        if self.placing:
            if self.in_view(pygame.mouse.get_pos()):
                self.draw_ghost(cmp)
        scr.set_clip(None)

    def draw_ghost(self, mp):
        if self.draw_defense_ghost(mp):
            return
        scr = self.screen
        w = self.world
        kind = self.placing
        tx, ty = self.place_tile(mp)
        s = BUILDINGS[kind]['size']
        ok = w.can_place(kind, tx, ty, 0)
        sx, sy = self.w2s(tx * TILE, ty * TILE, terrain.footprint_z(w, tx, ty, s, s))
        spr, ox, oy, _ = self.bsprite(kind, 0, None, *self.blook(kind, 0, tx, ty))
        ghost = spr.copy()
        ghost.set_alpha(150)
        scr.blit(ghost, (sx - ox, sy - oy))
        pts = self.diamond(tx, ty, s, s)          # the corners - at their own height (a diamond along the slope)
        minx = min(p[0] for p in pts)
        miny = min(p[1] for p in pts)
        ov = pygame.Surface((int(max(p[0] for p in pts) - minx) + 2, int(max(p[1] for p in pts) - miny) + 2),
                            pygame.SRCALPHA)
        pygame.draw.polygon(ov, (60, 255, 60, 80) if ok else (255, 50, 50, 100),
                            [(p[0] - minx, p[1] - miny) for p in pts])
        scr.blit(ov, (minx, miny))
        rng = BUILDINGS[kind].get('rng') and w.players[0].stat('rng', kind, BUILDINGS[kind]['rng'])
        if rng:
            cx, cy = self.w2s((tx + s / 2) * TILE, (ty + s / 2) * TILE)
            R = (rng + s / 2) * TILE
            pygame.draw.ellipse(scr, (255, 255, 255), (cx - R * 1.414, cy - R * 0.707, R * 2.828, R * 1.414), 1)

    def draw_fog(self):
        w = self.world
        if self.fog_full_ver != w.fog_version:
            MAP_W, MAP_H = w.W, w.H
            self.fog_full_ver = w.fog_version
            n = MAP_W * MAP_H
            buf = bytearray(n * 4)
            # we build the "visibility" (255 - visible, 130 - explored), beyond the map it is 0 -> solid darkness;
            # without a loop over cells: bytes 0/1 -> 0/255 and 0/130, then a bitwise OR (255 | 130 == 255)
            a = int.from_bytes(bytes(w.vis).translate(_FOG_VIS), 'little') | \
                int.from_bytes(bytes(w.explored).translate(_FOG_EXP), 'little')
            buf[3::4] = a.to_bytes(n, 'little')
            small = pygame.image.frombuffer(bytes(buf), (MAP_W, MAP_H), 'RGBA')
            sq = pygame.transform.smoothscale(small, (MAP_W * 4, MAP_H * 4))
            rot = pygame.transform.rotate(sq, -45)
            fog = pygame.Surface((self.iso_tw // FOG_S, self.iso_th // FOG_S), pygame.SRCALPHA)
            fog.fill((0, 0, 0, 255))
            fog.blit(pygame.transform.smoothscale(rot, fog.get_size()), (0, 0), special_flags=pygame.BLEND_RGBA_SUB)
            terrain_gfx.warp_fog(fog, getattr(self, 'fog_rows', None))       # fog raised along the relief
            self.fog_full = fog
            self.fog_view = None
        rx, ry = int(self.cam_x // FOG_S), int(self.cam_y // FOG_S)
        vw, vh = getattr(self, '_vw', SCREEN_W), getattr(self, '_vh', SCREEN_H - TOP_H)
        key = (rx, ry, self.fog_full_ver, vw, vh)
        if self.fog_view is None or self.fog_view[0] != key:
            fw, fh = self.fog_full.get_size()
            rw = min(int(vw) // FOG_S + 2, fw - rx)
            rh = min(int(vh) // FOG_S + 2, fh - ry)
            sub = self.fog_full.subsurface((rx, ry, rw, rh))
            self.fog_view = (key, pygame.transform.smoothscale(sub, (rw * FOG_S, rh * FOG_S)))
        self.screen.blit(self.fog_view[1], (rx * FOG_S - self.cam_x, ry * FOG_S - self.cam_y + TOP_H))

    REL_BAR = {'me': (70, 220, 80), 'ally': (90, 190, 230), 'enemy': (230, 70, 60), 'gaia': (230, 70, 60)}
    REL_SEL = {'me': (255, 255, 255), 'ally': (150, 220, 255), 'enemy': (255, 120, 100), 'gaia': (255, 255, 255)}

    def hpbar(self, x, y, wdt, frac, owner):
        frac = max(0.0, min(1.0, frac))
        pygame.draw.rect(self.screen, (25, 20, 20), (x - 1, y - 1, wdt + 2, 5))
        c = self.REL_BAR[self.relation(owner)]
        pygame.draw.rect(self.screen, c, (x, y, int(wdt * frac), 3))

    def draw_fish(self, n, sx, sy, selected):
        """A 0 A.D. fish: a school/large fish under water, rings spread above them; fading as it is depleted."""
        t = self.world.time + n.var * 0.37 + n.tx * 0.13
        full = NODE_DEFS[n.kind].get('amount') or 1
        fr = sprites_extra.fish(n.kind, n.var + n.tx + n.ty, t, 110 + 145 * min(1.0, n.amount / full))
        if fr is None:
            return False
        scr = self.screen
        if selected:
            pygame.draw.polygon(scr, (255, 255, 255), self.diamond(n.tx, n.ty, 1, 1), 1)
        sprites_extra.blit(scr, sprites_extra.ripple(t), sx, sy)
        sprites_extra.blit(scr, fr, sx, sy)
        # a click is caught by the cell's diamond (the fish is translucent - it cannot be hit by pixels)
        pk = _FISH_PICK[0]
        if pk is None:
            pk = _FISH_PICK[0] = pygame.Surface((56, 28), pygame.SRCALPHA)
            pygame.draw.polygon(pk, (255, 255, 255, 255), [(28, 0), (56, 14), (28, 28), (0, 14)])
        self.drawn.append((pygame.Rect(int(sx) - 28, int(sy) - 14, 56, 28), n, pk))
        return True

    @staticmethod
    def node_stage(n):
        """The depletion stage of a gold/stone vein: 0 - > 66 % of the stock, 1 - > 33 %, 2 - less."""
        if n.kind not in ('gold', 'stone'):
            return 0
        f = n.amount / (NODE_DEFS[n.kind].get('amount') or 1)
        return 0 if f > 0.66 else 1 if f > 0.33 else 2

    def draw_cliff(self, c, sx, sy):
        """A cliff boulder on the cell (tx, ty, variant); without the atlas - a procedural rock."""
        r3 = sprites3d.cliff(c[2])
        if r3 is not None:
            spr, ox, oy = r3
            self.screen.blit(spr, (int(sx - ox), int(sy - HH - oy)))
            return
        rr = random.Random(c[2])
        pts = [(sx - 30, sy + 6), (sx - 22 + rr.randint(-4, 4), sy - 22), (sx - 4, sy - 38 + rr.randint(-6, 6)),
               (sx + 14, sy - 30 + rr.randint(-6, 6)), (sx + 30, sy + 4), (sx, sy + 16)]
        pygame.draw.polygon(self.screen, (122, 108, 90), pts)
        pygame.draw.polygon(self.screen, (150, 136, 112), pts[2:5] + [(sx + 4, sy)])
        pygame.draw.lines(self.screen, (70, 60, 50), True, pts, 1)

    def draw_node(self, n, sx, sy, selected):
        if NODE_DEFS[n.kind].get('water') and self.draw_fish(n, sx, sy, selected):
            return
        scr = self.screen
        r3 = (map_assets.tree(self.world, n.tx, n.ty, n.var) or sprites3d.tree(n.tx, n.ty, n.var)) \
            if n.kind == 'tree' else \
            sprites3d.node(n.kind, n.var, self.node_stage(n)) if n.kind in ('gold', 'stone', 'berries') else None
        if r3 is not None:
            spr, ox, oy = r3
            pos = (int(sx - ox), int(sy - HH - oy))      # (ox, oy) - the top corner of the cell's diamond
        elif n.kind == 'tree':
            spr = self.trees[n.var]
            ax, ay = gfx.TREE_ANCHOR
            pos = (int(sx - ax), int(sy - ay + 4))
        else:
            spr = self.node_spr[n.kind][n.var % len(self.node_spr[n.kind])]
            if NODE_DEFS[n.kind].get('anchor') == 'center':
                pos = (int(sx - spr.get_width() / 2), int(sy - spr.get_height() / 2))
            else:
                pos = (int(sx - spr.get_width() / 2), int(sy - spr.get_height() + 12))
        if selected:
            pygame.draw.polygon(scr, (255, 255, 255), self.diamond(n.tx, n.ty, 1, 1), 1)
        anim = NODE_DEFS[n.kind].get('anim')
        if anim:
            anim(scr, n, sx, sy, self.world.time)
        scr.blit(spr, pos)
        self.drawn.append((pygame.Rect(pos, spr.get_size()), n, spr))

    def draw_building(self, b, sx, sy, selected):
        scr = self.screen
        spr, ox, oy, bb = self.bsprite_for(b)
        x, y = sx - ox, sy - oy
        if selected:
            c = self.REL_SEL[self.relation(b.owner)]
            pygame.draw.polygon(scr, c, self.diamond(b.tx, b.ty, b.w, b.h), 1)
        if b.complete:
            scr.blit(spr, (x, y))
            self.drawn.append((pygame.Rect(x, y, *spr.get_size()), b, spr))
            if b.hit_t > 0 and self.world.time - b.hit_t < 0.1:
                pygame.draw.polygon(scr, (255, 255, 255), self.diamond(b.tx, b.ty, b.w, b.h), 1)
            if b.hp <= b.max_hp * 0.75 and not self.draw_fire(b, sx, y + bb.top, bb.height) and b.hp < b.max_hp * 0.5:
                t = self.world.time
                cx = sx
                top = y + bb.top
                for i in range(2 if b.hp > b.max_hp * 0.25 else 4):
                    fx = cx + (i - 1.5) * b.w * 9
                    fy = top + 20 + i * 6 - ((t * 20 + i * 13) % 20)
                    pygame.draw.circle(scr, (255, 140 + i * 20, 40), (int(fx), int(fy)), 5 - (i % 2))
                    pygame.draw.circle(scr, (90, 90, 90), (int(fx + 3), int(fy - 12)), 4)
            if b.garrison:
                self.draw_garrison_badge(b, sx, y + bb.top)
        elif b.d.get('wall') and self.draw_wall_build(b, sx, sy, spr, ox, oy, bb):
            pass
        elif not b.d.get('wall') and self.bsprite(b.kind, b.owner, min(2, int(b.progress * 3)), 0,
                                                  self.blook(b.kind, b.owner, b.tx, b.ty)[1]) is not None:
            # construction stages from 3D: foundation -> a third in scaffolding -> two thirds in scaffolding
            st, sox, soy, _ = self.bsprite(b.kind, b.owner, min(2, int(b.progress * 3)), 0,
                                           self.blook(b.kind, b.owner, b.tx, b.ty)[1])
            scr.blit(st, (sx - sox, sy - soy))
            self.drawn.append((pygame.Rect(sx - sox, sy - soy, *st.get_size()), b, st))
            pts = self.diamond(b.tx, b.ty, b.w, b.h)
            self.hpbar(sx - 30, pts[2][1] - 8, 60, b.progress, 0)
        else:
            pygame.draw.polygon(scr, (140, 108, 70), self.diamond(b.tx, b.ty, b.w, b.h))
            pygame.draw.polygon(scr, (95, 70, 44), self.diamond(b.tx, b.ty, b.w, b.h), 2)
            h = spr.get_height()
            vis_h = int((h - bb.top) * (0.08 + 0.92 * b.progress))
            if vis_h > 0:
                part = spr.subsurface((0, h - vis_h, spr.get_width(), vis_h)).copy()
                part.set_alpha(200)
                scr.blit(part, (x, y + h - vis_h))
            pts = self.diamond(b.tx, b.ty, b.w, b.h)
            ph = 20 + 50 * b.progress
            for p in pts[1:]:
                pygame.draw.line(scr, (160, 120, 70), p, (p[0], p[1] - ph), 3)
            pygame.draw.line(scr, (160, 120, 70), (pts[3][0], pts[3][1] - ph * 0.6),
                             (pts[2][0], pts[2][1] - ph * 0.6), 2)
            pygame.draw.line(scr, (160, 120, 70), (pts[2][0], pts[2][1] - ph * 0.6),
                             (pts[1][0], pts[1][1] - ph * 0.6), 2)
            self.drawn.append((pygame.Rect(x, y, *spr.get_size()), b, spr))
            self.hpbar(sx - 30, pts[2][1] - 8, 60, b.progress, 0)

    # ---- small graphics from 0 A.D. (game/sprites_extra.py); False - no sprites, draw the old way
    RUBBLE_LIFE, RUBBLE_FADE, RUBBLE_BURN = 60.0, 10.0, 9.0      # DE: rubble 60 s (world.DECAL_LIFE)

    def draw_rubble(self, d, sx, sy):
        """Rubble: a heap by the building's size and material, for the first seconds it still burns, at the end it melts away."""
        age = self.world.time - d[4]
        kind = d[5] if len(d) > 5 else None
        s = d[3]
        fr = sprites_extra.rubble(s, kind, min(255, (self.RUBBLE_LIFE - age) / self.RUBBLE_FADE * 255))
        if fr is None:
            return False
        scr = self.screen
        sprites_extra.blit(scr, fr, sx, sy)
        if age < self.RUBBLE_BURN:
            k = 1.0 - age / self.RUBBLE_BURN
            t = self.world.time
            rr = random.Random(d[1] * 131 + d[2])
            for i in range(1 + s):
                ox = (rr.random() - 0.5) * s * 30
                oy = (rr.random() - 0.5) * s * 12
                ph = rr.random()
                if i == 0:
                    sprites_extra.blit(scr, sprites_extra.smoke(t, ph, 200 * k), sx + ox, sy + oy - 4)
                sprites_extra.blit(scr, sprites_extra.flame(t, ph, 255 * min(1.0, k * 1.6)), sx + ox, sy + oy)
        return True

    def draw_fire(self, b, sx, top, height):
        """A burning building, 3 stages as in DE: <= 75 % health - a small fire, <= 50 % - a medium one with smoke,
        <= 25 % - a strong one (the center has 6 seats of fire)."""
        if sprites_extra.group('flame') is None:
            return False
        t = self.world.time
        f = b.hp / max(1, b.max_hp)
        stage = 3 if f <= 0.25 else 2 if f <= 0.5 else 1
        big = (1 if b.w >= 3 else 0) + (1 if b.w >= 4 and stage == 3 else 0)
        n = (1, 2, 4)[stage - 1] + big
        rr = random.Random(b.tx * 977 + b.ty * 31)
        pts = []
        for i in range(n):
            ox = (rr.random() - 0.5) * b.w * 26
            oy = top + height * (0.22 + rr.random() * 0.3)
            pts.append((sx + ox, oy, rr.random()))
        scr = self.screen
        if stage >= 2:
            for x, y, ph in pts[:stage - 1]:
                sprites_extra.blit(scr, sprites_extra.smoke(t, ph, 210), x, y - 6)
        a = 170 if stage == 1 else 255
        for x, y, ph in pts:
            sprites_extra.blit(scr, sprites_extra.flame(t, ph, a), x, y)
        return True

    def draw_carcass(self, e, fx, fy, sx, sy):
        """A killed animal's carcass: whole -> butchered -> a skeleton as meat is taken from it."""
        full = ANIMALS.get(e.kind, {}).get('food') or 1
        fr = sprites_extra.carcass(e.kind, e.amount / full, fx, fy)
        if fr is None:
            return False
        sprites_extra.blit(self.screen, fr, sx, sy)
        return True

    # ---- a unit's frame: box, height, the click list
    def note_unit(self, u, spr, x, y, sx, sy):
        """Remember a unit's drawn frame (a click by the body's pixels, a margin of +-4 px): the rect on the canvas and its
        offset from the feet point (the unit could have moved between the frame and the click)."""
        r = pygame.Rect(x, y, spr.get_width(), spr.get_height())
        self.drawn_u.append((r, u, spr))
        self._urect[id(u)] = (x - sx, y - sy, r.w, r.h)

    def frame_bbox(self, spr):
        """The bounding box of a frame's opaque pixels (cached by surface - the sets' frames live in the USet cache)."""
        k = id(spr)
        bb = self._bbc.get(k)
        if bb is None:
            if len(self._bbc) > 4096:
                self._bbc.clear()
            bb = self._bbc[k] = spr.get_bounding_rect(min_alpha=128)
        return bb

    def unit_frame(self, u):
        """(frame, ax, ay) of a unit in its current pose or None (no 3D set)."""
        us = _uset(u, self.civ_of(u.owner))
        if us is None:
            return None
        moving = u.state == 'move' or bool(u.path)
        moving = moving if u.naval else (u.x != u._px or u.y != u._py)
        name, k = unit_pose(u, us, self.world.time, moving)
        return us.frame(us.index(name, us.face(*u.face), k), self.pcolor(u.owner))

    def unit_top(self, u, pad=6):
        """The height of the crown above the feet point in the current frame (health bar, group number): by the box of this
        direction's frame, not by the set's maximum (09 - #24-25: trebuchet +30, a fisher in a sail)."""
        fr = self.unit_frame(u)
        if fr is None:
            return u.d.get('bar') or u.d.get('bar_h') or (36 if u.cls == 'cav' else 30)
        spr, ax, ay = fr
        bb = self.frame_bbox(spr)
        if bb.w == 0:
            return ay + pad
        return ay - bb.top + pad

    def draw_projectile(self, pr, shape, x, y, prog, total, tx, ty):
        """A projectile sprite: an arrow/bolt/javelin is rotated along the tangent to the flight arc, stones and cannonballs tumble."""
        if getattr(pr, 'ball', False):
            key = 'ball'
        elif shape == 'ball':
            key = 'shot'
        else:
            key = shape if shape in ('stone', 'bolt', 'javelin') else 'arrow'
        # the tangent to the screen trajectory: the straight line from the start to the target minus the arc sin(pi*prog)*A
        x0, y0 = self.w2s(pr.sx, pr.sy)
        x1, y1 = self.w2s(tx, ty)
        amp = min(40, total * 0.2)
        dx = x1 - x0
        dy = y1 - y0 - amp * math.pi * math.cos(prog * math.pi)
        fr = sprites_extra.projectile(key, dx, dy, self.world.time + (id(pr) & 7) * 0.1)
        if fr is None:
            return False
        sprites_extra.blit(self.screen, fr, x, y)
        return True

    BODY_HOLD, BODY_FADE = 285.0, 15.0        # DE: a body ~ 300 s (world.DECAL_LIFE)

    def draw_body(self, u, x, y, owner, age, onscr):
        """A fallen unit: the death animation, then the last frame lies and melts. Machines and ships without a
        death animation settle and dissolve. True - drawn (or already melted)."""
        us = _uset(u, self.civ_of(owner))
        if us is None:
            return False
        sx, sy = self.w2s(x, y)
        if not onscr(sx, sy):
            return True
        d8 = us.face(*u.face)
        a = us.anims.get('death')
        col = self.pcolor(owner)
        if a is not None:
            k = min(a['n'] - 1, int(age / (a['dur'] or 1.0) * a['n']))
            spr, ax, ay = us.frame(us.index('death', d8, k), col)
            alpha = 255 if age < self.BODY_HOLD else int(255 * max(0.0, 1 - (age - self.BODY_HOLD) / self.BODY_FADE))
            sink = 0
        else:
            spr, ax, ay = us.frame(us.index('idle', d8, 0), col)
            f = min(1.0, age / 2.5)
            alpha = int(255 * (1 - f))
            sink = int(f * (14 if u.naval else 4))
        if alpha <= 0:
            return True
        if alpha < 255 or sink:
            h = spr.get_height() - sink
            if h <= 0:
                return True
            spr = spr.subsurface((0, 0, spr.get_width(), h)).copy()
            spr.set_alpha(alpha)
        self.screen.blit(spr, (int(sx) - ax, int(sy) - ay + sink))
        return True

    def ship_wake(self, u, us, sx, sy):
        """A foam trail behind a moving ship (under the sprite)."""
        fx, fy = u.face
        ex, ey = fx - fy, (fx + fy) / 2
        L = us.h * 0.9 + 10
        t = self.world.time
        for i in range(3):
            f = ((t * 1.5 + i / 3) % 1.0)
            cx, cy = sx - ex * L * (0.3 + f * 0.9), sy - ey * L * (0.3 + f * 0.9)
            r = 6 + f * 16
            pygame.draw.ellipse(self.screen, (225, 238, 245), (cx - r, cy - r / 2, 2 * r, r), 1)

    def shot_fx(self, u, us, sx, sy):
        """A muzzle flash for firearm units and cannon ships, a jet of fire for fire ships."""
        d = u.d
        fire = d.get('fire')
        if not (fire or d.get('shot') == 'ball' or d.get('siege')):
            return
        fx, fy = u.face
        ex, ey = fx - fy, (fx + fy) / 2
        n = math.hypot(ex, ey) or 1.0
        ex, ey = ex / n, ey / n
        a = min(1.0, u.swing / 0.3)
        bh = us.bh
        if u.naval:
            reach, lift = us.h * 0.8 + 12, us.h * 0.35
        elif d.get('siege'):
            reach, lift = us.h * 0.55 + 6, us.h * 0.45
        elif u.cls == 'cav':
            reach, lift = bh * 0.55, bh * 0.86         # a rider's musket at the shoulder
        else:
            reach, lift = bh * 0.6, bh * 0.84           # the muzzle of an arquebus/hand cannon at the shoulder, a barrel length forward
        x0, y0 = sx + ex * reach, sy + ey * reach * (0.8 if u.naval else 0.5) - lift
        scr = self.screen
        if fire:
            x1, y1 = x0 + ex * 34, y0 + ey * 22
            pygame.draw.line(scr, (255, 150, 40), (x0, y0), (x1, y1), 5)
            pygame.draw.line(scr, (255, 235, 140), (x0, y0), (x1, y1), 2)
            return
        # smoke: puffs spread from the muzzle and rise
        for i in range(3):
            r = int(3 + (1 - a) * 8 + i * 2)
            c = int(170 + 60 * a)
            pygame.draw.circle(scr, (c, c - 4, c - 10), (int(x0 + ex * i * 5), int(y0 - i * 3 * (1 - a))), r)
        if a > 0.55:
            # flash: a tongue of flame elongated along the barrel + a white core
            k = (a - 0.55) / 0.45
            L = 6 + 10 * k
            px, py = -ey, ex
            tip = (x0 + ex * L, y0 + ey * L * 0.8)
            w = 2.5 + 2.5 * k
            pygame.draw.polygon(scr, (255, 170, 50), [(x0 + px * w, y0 + py * w), tip, (x0 - px * w, y0 - py * w)])
            pygame.draw.circle(scr, (255, 235, 150), (int(x0), int(y0)), int(2 + 2 * k))
            pygame.draw.circle(scr, (255, 255, 235), (int(x0), int(y0)), 1 + int(k))

    def draw_unit_w(self, u, sx, sy, selected):
        scr = self.screen
        moving = u.state == 'move' or bool(u.path)
        col = self.pcolor(u.owner)
        if u.hit_t > 0 and self.world.time - u.hit_t < 0.1:
            col = (255, 255, 255)
        us = _uset(u, self.civ_of(u.owner))
        if us is not None:
            # a ship at rest does not update _px - for it "moving" = a move order
            moving = moving if u.naval else (u.x != u._px or u.y != u._py)
            name, k = unit_pose(u, us, self.world.time, moving)
            fx, fy = u.face
            spr, ax, ay = us.frame(us.index(name, us.face(fx, fy), k), col)
            x, y = int(sx) - ax, int(sy) - ay
            if selected:
                # selection ellipse: for machines and ships the origin of the 0 A.D. model is not at the body's center - by the frame's center
                ex = sx
                if u.naval or u.cls == 'siege':
                    bb = self.frame_bbox(spr)
                    ex = x + (bb.left + bb.right) / 2
                c = (120, 255, 120) if u.owner == 0 else self.REL_SEL[self.relation(u.owner)]
                rw = u.radius * 2.4 + 8
                pygame.draw.ellipse(scr, c, (ex - rw / 2, sy - rw / 4, rw, rw / 2), 1)
            if u.naval and moving:
                self.ship_wake(u, us, sx, sy)
            scr.blit(spr, (x, y))
            self._ublit = (spr, x, y)
            self.note_unit(u, spr, x, y, sx, sy)
            if u.swing > 0:
                self.shot_fx(u, us, sx, sy)
            return
        if selected:
            c = (120, 255, 120) if u.owner == 0 else self.REL_SEL[self.relation(u.owner)]
            rw = u.radius * 2.4 + 8
            pygame.draw.ellipse(scr, c, (sx - rw / 2, sy - rw / 4, rw, rw / 2), 1)
        fx, fy = u.face
        face = (fx - fy, (fx + fy) / 2)
        carry = u.carry_res if u.carry >= 1 else None
        if u.naval:
            gfx.draw_unit(scr, u.look(), col, sx, sy, face, u.anim, u.swing, UNIT_K, carry, moving)
            return
        # a figure from the cache: the pose is quantized (8 directions, 16 step phases, 10 swing steps) - we draw
        # the figure once onto a separate surface and then only copy it (otherwise ~20 draw calls per unit)
        qf = _qface(face[0], face[1])
        qa = round((u.anim % _TAU) * _ANIM_Q) % 16 if moving else 0
        sw = u.swing
        qs = -int(-sw // 0.03) if sw > 0 else 0          # upward: any swing > 0 stays a swing
        key = (u.look(), col, qf, qa, qs, carry, moving)
        hit = _USPR.get(key)
        if hit is None:
            hit = _render_unit(key)
        spr, dx, dy = hit
        scr.blit(spr, (int(sx) + dx, int(sy) + dy))

    def draw_silhouettes(self, drawn_units):
        """Units behind buildings and trees (DE): where a unit's body is covered by a sprite drawn later
        (closer to the viewer) - a translucent silhouette in the player's color. Intersections are found by boxes (C level,
        Rect.collidelistall), per pixel - only for units that are really overlapped; masks are cached."""
        rects, occ = [], []
        for i, (r, e, spr) in enumerate(self.drawn):
            if isinstance(e, Building) or (isinstance(e, Node) and e.kind == 'tree'):
                rects.append(r)
                occ.append((i, spr))
        if not rects:
            return
        scr = self.screen
        for i0, (spr, x, y), col in drawn_units:
            hits = pygame.Rect(x, y, *spr.get_size()).collidelistall(rects)
            if not hits:
                continue
            cover = None
            um = None
            for h in hits:
                j, ospr = occ[h]
                if j < i0:
                    continue            # drawn before the unit - behind it
                if um is None:
                    um = _mask(spr, 150)
                r = rects[h]
                m = um.overlap_mask(_mask(ospr, 128), (r.x - x, r.y - y))
                if cover is None:
                    cover = m
                else:
                    cover.draw(m, (0, 0))
            if cover is not None and cover.count():
                scr.blit(cover.to_surface(setcolor=(*col, 150), unsetcolor=(0, 0, 0, 0)), (x, y))

    def draw_messages(self):
        # on the left under the group icons, on a dark backing (DE)
        w = self.world
        y = TOP_H + 44
        for (txt, t, col) in w.messages:
            if w.time - t < 10 and not self.show_history:
                img = self.fonts['b'].render(txt, True, col)
                uiskin.shade_overlay(self.screen, (8, y - 1, img.get_width() + 12, 20), alpha=110)
                self.text(txt, (14, y), 'b', col)
                y += 21
