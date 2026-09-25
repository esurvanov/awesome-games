"""Pre-rendered sprites from 3D models of 0 A.D. and the Millennium A.D. mod (assets/gen/, built by tools/build_sprites.py).

If the folder is missing or the atlas is unreadable - `available()` returns False and the game draws procedural graphics.
Everything loads lazily and is cached: buildings - by (kind, civilization group, color, stage), nature - by file.
Player color: pixel x (1 - m*(1 - color)), m - a mask from the alpha channel of the 0 A.D. texture (0 - not painted).
"""
import collections
import json
import math
import os
import queue
import threading
import time

import pygame

from . import terrain

GEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'gen')

_atlas = None
_tried = False
_img = {}
_bld = {}
_nat = {}
_tiles = {}


def atlas():
    global _atlas, _tried
    if not _tried:
        _tried = True
        if os.environ.get('NO_SPRITES3D'):
            return None
        try:
            with open(os.path.join(GEN, 'atlas.json'), encoding='utf-8') as f:
                _atlas = json.load(f)
        except (OSError, ValueError):
            _atlas = None
    return _atlas


def available():
    return atlas() is not None


def _load(rel, alpha=True):
    s = _img.get(rel)
    if s is None:
        s = pygame.image.load(os.path.join(GEN, rel))
        if pygame.display.get_surface() is not None:
            s = s.convert_alpha() if alpha else s.convert()
        _img[rel] = s
    return s


# Player color (DE): by the mask a pixel is replaced by the player's color of the same brightness as the texture's -
#   out = lerp(base, c*(TA + TB*L) + TD*L*255, m),  L - the pixel's brightness (0...1), m - the mask (0...1).
# The former "base x c" gave dark brown blotches (the cloth in 0 A.D. textures is brown, ~ (105, 94, 76)).
TA, TB, TD = 0.40, 0.85, 0.30      # tuned to DE: purple on the knight ~ (112, 45, 150), DE (107, 50, 141)


def _mask_rgb(mk):
    """The mask as an opaque 32-bit RGB surface (for BLEND_RGB_*)."""
    if mk.get_bitsize() != 32 or mk.get_flags() & pygame.SRCALPHA:
        m = pygame.Surface(mk.get_size())
        m.blit(mk.convert() if pygame.display.get_surface() is not None else mk, (0, 0))
        mk = m
    return mk


def _tint_aux(base, mk):
    """(brightness L, 255 - mask) for recoloring; compute once per sheet."""
    gray = pygame.Surface(base.get_size())
    gray.blit(pygame.transform.grayscale(base), (0, 0))
    inv = pygame.Surface(mk.get_size())
    inv.fill((255, 255, 255))
    inv.blit(mk, (0, 0), special_flags=pygame.BLEND_RGB_SUB)
    return gray, inv


def recolor(base, mk, gray, inv, color):
    """base (RGBA) with the mask area mk recolored to color while keeping brightness (gray, inv - _tint_aux)."""
    t = gray.copy()
    t.fill(tuple(min(255, int(c * TB + 255 * TD)) for c in color), special_flags=pygame.BLEND_RGB_MULT)
    t.fill(tuple(int(c * TA) for c in color), special_flags=pygame.BLEND_RGB_ADD)
    t.blit(mk, (0, 0), special_flags=pygame.BLEND_RGB_MULT)
    out = base.copy()
    out.blit(inv, (0, 0), special_flags=pygame.BLEND_RGB_MULT)
    out.blit(t, (0, 0), special_flags=pygame.BLEND_RGB_ADD)
    return out


def _tinted(rec, color):
    """An RGBA sprite of an atlas entry, recolored to the player's color by the mask."""
    base = _load(rec['file'])
    if not rec.get('mask') or color is None:
        return base
    mk = _mask_rgb(_load(rec['mask'], alpha=False))
    return recolor(base, mk, *_tint_aux(base, mk), color)


# ------------------------------------------------------------------ buildings
def civ_group(civ):
    a = atlas() or {}
    cg = a.get('civ_groups', {})
    return cg.get(civ or 'default') or cg.get('default', 'caro')


def building_rec(kind, civ):
    a = atlas()
    if a is None:
        return None
    bl = a.get('buildings', {})
    g = civ_group(civ)
    rec = bl.get(g, {}).get(kind)
    if rec is None:
        rec = bl.get(a.get('civ_groups', {}).get('default', 'caro'), {}).get(kind)
    return rec


def variants(kind, civ):
    """The number of variants of a building model (houses: 2-3, chosen by tile)."""
    rec = building_rec(kind, civ)
    return len(rec.get('variants') or ()) or 1 if rec else 1


def building(kind, civ, color, stage=None, var=0, land=None):
    """(surface, ox, oy) of a finished building (stage=None) or construction stage 0..2; None - no sprite.
    var - the model variant number (houses), land - (dx, dy) the shore side of a dock."""
    rec = building_rec(kind, civ)
    if rec is None:
        return None
    if land is not None and rec.get('dirs'):
        rec = rec['dirs'].get('%d,%d' % tuple(land), rec)
    if stage is None and rec.get('variants'):
        rec = rec['variants'][var % len(rec['variants'])]
    if stage is not None:
        st = rec.get('stages') or []
        if not st:
            return None
        rec = st[max(0, min(len(st) - 1, stage))]
    key = (rec['file'], tuple(color) if color else None)
    hit = _bld.get(key)
    if hit is None:
        hit = _bld[key] = (_tinted(rec, color), rec['ox'], rec['oy'])
    return hit


# ------------------------------------------------------------------ nature
def _nat_list(kind):
    a = atlas()
    if a is None:
        return None
    return a.get('nature', {}).get(kind) or None


def _hash(x, y, s=0):
    h = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    return (h ^ (h >> 13)) & 0x7fffffff


def tree(tx, ty, var):
    """(surface, ox, oy) of a tree on a tile: species grow in patches (7x7 tiles), inside a patch - a mix of variants
    (species - game.terrain.tree_species: under conifers - a conifer floor)."""
    trees = _nat_list('trees')
    if not trees:
        return None
    sp = terrain.tree_species(tx, ty, {n for n in trees if trees.get(n)})
    lst = trees[sp]
    rec = lst[(_hash(tx, ty, 3) + var) % len(lst)]
    hit = _green.get(rec['file'])
    if hit is None:
        surf, ox, oy = _nat_sprite(rec)
        hit = _green[rec['file']] = (_greener(surf), ox, oy)
    return hit


# DE foliage (de_forest_town.jpg): hue ~ 85-92 deg, saturation ~ 0.5, brightness ~ 0.36; our trees'
# (0 A.D. light) - 62-82 deg, 0.65-0.8, 0.2-0.5 - look yellowish. Correction on load: hue toward GREEN_H, saturation softer.
GREEN_H, GREEN_K, GREEN_S, GREEN_V = 90.0, 0.7, 0.82, 1.15
_green = {}


def _greener(surf):
    """A copy of a tree sprite with the foliage shifted from yellow to green (bark and shadows barely change)."""
    import numpy as np
    out = surf.copy()
    rgb = pygame.surfarray.pixels3d(out)
    a = rgb.astype(np.float32) / 255.0
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    d = mx - mn
    # hue in degrees only for greenish-yellow pixels (the maximum is the green channel or red close to it)
    with np.errstate(divide='ignore', invalid='ignore'):
        h = np.nan_to_num(np.where(mx == g, 120.0 + 60.0 * (b - r) / d, 60.0 * ((g - b) / d % 6)))
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0.0)
    leaf = (d > 0.04) & (h >= 40.0) & (h <= 115.0) & (g >= r * 0.8)
    w = np.clip((sat - 0.15) / 0.25, 0.0, 1.0) * leaf           # grey/brown pixels (bark) - no shift
    h2 = h + (GREEN_H - h) * GREEN_K * w
    s2 = sat * (1.0 + (GREEN_S - 1.0) * w)
    v2 = np.minimum(1.0, mx * (1.0 + (GREEN_V - 1.0) * w))
    # HSV → RGB
    c = v2 * s2
    hp = (h2 / 60.0) % 6
    x = c * (1 - np.abs(hp % 2 - 1))
    m = v2 - c
    z = np.zeros_like(c)
    sec = hp.astype(np.int32)
    rr = np.choose(sec, [c, x, z, z, x, c])
    gg = np.choose(sec, [x, c, c, x, z, z])
    bb = np.choose(sec, [z, z, x, c, c, x])
    new = np.stack([rr + m, gg + m, bb + m], axis=2)
    sel = w > 0
    a[sel] = new[sel]
    rgb[...] = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
    del rgb
    return out


def cliff(var):
    """(surface, ox, oy) of a cliff boulder (tools/build_nature.py build_cliffs) or None."""
    lst = _nat_list('cliffs')
    if not lst:
        return None
    return _nat_sprite(lst[var % len(lst)])


def _nat_sprite(rec, color=None):
    key = (rec['file'], tuple(color) if color else None)
    hit = _nat.get(key)
    if hit is None:
        hit = _nat[key] = (_tinted(rec, color), rec['ox'], rec['oy'])
    return hit


_NODE_STAGE = (1.0, 0.86, 0.72)          # the ore vein's scale by stage: > 66 %, > 33 %, the remainder (DE: n_mine_*_66 / _33)
_node_st = {}


def node(kind, var, stage=0):
    """(surface, ox, oy) of a resource; stage 1..2 - a depleted vein (a smaller pile, as in DE at 66 % and 33 %)."""
    lst = _nat_list(kind)
    if not lst:
        return None
    base = _nat_sprite(lst[var % len(lst)])
    if not stage:
        return base
    key = (kind, var % len(lst), stage)
    hit = _node_st.get(key)
    if hit is None:
        surf, ox, oy = base
        k = _NODE_STAGE[min(stage, 2)]
        w, h = max(1, round(surf.get_width() * k)), max(1, round(surf.get_height() * k))
        # scale around the tile's center on the ground (ox, oy + 16): the pile settles in place
        cx, cy = ox, oy + 16
        hit = _node_st[key] = (pygame.transform.smoothscale(surf, (w, h)), round(cx * k), round(cy * k) - 16)
    return hit


def animal(kind, var, face, color=None):
    """A static animal sprite; face - the direction (fx, fy) in world coordinates."""
    an = _nat_list('animals')
    if not an or not an.get(kind):
        return None
    vs = an[kind]
    dirs = vs[var % len(vs)]
    d = int(round(math.atan2(face[1], face[0]) / (math.pi / 4))) % 8
    return _nat_sprite(dirs[d % len(dirs)], color)


def farm(level):
    """A 3x3 field: level 0 - plowed, 4 - a full harvest."""
    lst = _nat_list('farm')
    if not lst:
        return None
    return _nat_sprite(lst[max(0, min(len(lst) - 1, level))])


def icon_rec(kind):
    """An entry for a natural resource icon (the first tree, the first mine...)."""
    if kind == 'tree':
        t = _nat_list('trees')
        if t:
            return _nat_sprite(t.get('oak', next(iter(t.values())))[0])
        return None
    return node(kind, 0)


# ------------------------------------------------------------------ terrain
def terrain_tile(name):
    a = atlas()
    if a is None:
        return None
    rec = a.get('terrain', {}).get(name)
    if rec is None:
        return None
    t = _tiles.get(name)
    if t is None:
        t = _tiles[name] = _load(rec['file'], alpha=False)
    return t


# terrain type blending, relief and slope light - game/terrain_gfx.py


# ------------------------------------------------------------------ walls
_WALL = {}


def _wall_set(kind, civ):
    a = atlas()
    if a is None:
        return None
    wk = 'palisade' if kind.startswith('palisade') else 'stone'
    wl = a.get('walls', {})
    return (wl.get(civ_group(civ)) or wl.get(a.get('civ_groups', {}).get('default', 'caro')) or {}).get(wk)


def wall_piece(kind, civ, color, mask, dirs):
    """A 1x1 wall segment from "arms" toward neighbors and a post: (surface, ox, oy) or None.
    dirs - a list of directions (dx, dy) by the mask bits (the order of game.defense.DIR8)."""
    ws = _wall_set(kind, civ)
    if ws is None:
        return None
    key = (kind, civ_group(civ), mask)
    hit = _WALL.get(key)
    if hit is not None:
        return hit
    ds = [d for i, d in enumerate(dirs) if mask & (1 << i)]
    straight = len(ds) == 2 and ds[0][0] == -ds[1][0] and ds[0][1] == -ds[1][1]
    back = sorted([d for d in ds if d[0] + d[1] < 0], key=lambda d: d[0] + d[1])
    side = [d for d in ds if d[0] + d[1] == 0]
    front = sorted([d for d in ds if d[0] + d[1] > 0], key=lambda d: d[0] + d[1])
    recs = [ws['arms'][f'{dx},{dy}'] for dx, dy in back + side]
    if not straight:
        recs.append(ws['post'])
    recs += [ws['arms'][f'{dx},{dy}'] for dx, dy in front]
    l = min(-r['ox'] for r in recs)
    t = min(-r['oy'] for r in recs)
    rgt = max(r['w'] - r['ox'] for r in recs)
    btm = max(r['h'] - r['oy'] for r in recs)
    surf = pygame.Surface((rgt - l, btm - t), pygame.SRCALPHA)
    for r in recs:
        surf.blit(_load(r['file']), (-l - r['ox'], -t - r['oy']))
    hit = _WALL[key] = (surf, -l, -t)
    return hit


def wall_build(kind, civ, part):
    """A wall-segment construction sprite: part = 'fndn' (foundation) | 'scaf' (scaffolding); (surface, ox, oy) or None."""
    ws = _wall_set(kind, civ)
    if ws is None or part not in ws:
        return None
    return _nat_sprite(ws[part])


def gate(kind, civ, color, horiz, opened):
    ws = _wall_set(kind, civ)
    if ws is None or 'gate' not in ws:
        return None
    rec = ws['gate'].get(f'{"h" if horiz else "v"}{int(bool(opened))}')
    if rec is None:
        return None
    return _nat_sprite(rec, color)


# ------------------------------------------------------------------ units (tools/build_units.py)
# Frame sheets are loaded lazily: the index - at the first unit in a frame, a set's sheet - at its first frame,
# recoloring to the player's color - frame by frame on first display (cache by (set, frame, color)).
_uidx = None
_utried = False
_usets = {}
_uset_of = {}
_UT_MAX = 12000


def units_index():
    global _uidx, _utried
    if not _utried:
        _utried = True
        if os.environ.get('NO_SPRITES3D') or os.environ.get('NO_UNIT_SPRITES'):
            return None
        try:
            with open(os.path.join(GEN, 'units', 'index.json'), encoding='utf-8') as f:
                _uidx = json.load(f)
        except (OSError, ValueError):
            _uidx = None
    return _uidx


class USet:
    """A set of frames of one model: animations x directions (16, 8 in old builds) x frames."""
    __slots__ = ('name', 'rec', 'anims', 'h', 'bh', 'sheet', 'mask', 'rects', 'tinted', 'plain', 'ndir')

    def __init__(self, name, rec):
        self.name = name
        self.rec = rec
        self.anims = rec['anims']
        self.h = rec.get('h') or 40
        # "body height" - to the crown (for spearmen h - to the spear tip): the health bar, selection
        self.bh = rec.get('bh') or self.h
        self.ndir = rec.get('dirs') or 8
        self.sheet = None
        self.mask = None
        self.rects = None
        self.tinted = {}
        self.plain = {}

    def _ensure(self):
        if self.sheet is not None:
            return
        rec = self.rec
        with open(os.path.join(GEN, rec['meta']), encoding='utf-8') as f:
            self.rects = json.load(f)['frames']
        self.sheet = _load(rec['file'])
        if rec.get('mask'):
            mk = _load(rec['mask'], alpha=False)
            self.mask = _mask_rgb(mk)

    def frame(self, i, color):
        """(surface, ax, ay) of frame i recolored to color (None - no recoloring)."""
        key = (i, color)
        hit = self.tinted.get(key)
        if hit is not None:
            return hit
        self._ensure()
        x, y, w, h, ax, ay = self.rects[i]
        base = self.sheet.subsurface((x, y, w, h))
        if self.mask is None or color is None:
            surf = base
        else:
            if color == (255, 255, 255):          # hit flash: the whole silhouette is lighter
                surf = base.copy()
                surf.fill((90, 90, 90), special_flags=pygame.BLEND_RGB_ADD)
            else:
                mk = self.mask.subsurface((x, y, w, h))
                surf = recolor(base, mk, *_tint_aux(base, mk), color)      # the frame is cached below
        if len(self.tinted) > _UT_MAX:
            self.tinted.clear()
        hit = self.tinted[key] = (surf, ax, ay)
        return hit

    def face(self, fx, fy):
        """The set's direction number by the look vector (fx, fy) in world coordinates."""
        return face_dir(fx, fy, self.ndir)

    def index(self, anim, d, k):
        """d - the set's direction number (see face)."""
        a = self.anims[anim]
        n = a['n']
        return a['i0'] + (d % self.ndir) * n + (k % n)


def unit_set(kind, civ, female=False):
    """USet for a unit kind (or 'animal_<kind>') and the owner's civilization; None - no sprites."""
    key = (kind, civ, female)
    s = _uset_of.get(key, 0)
    if s != 0:
        return s
    idx = units_index()
    s = None
    if idx is not None:
        m = idx['units'].get('villager_f' if female and kind == 'villager' else kind)
        if m:
            dg = idx.get('default', 'caro')
            g = idx['groups'].get(civ_group(civ), dg)
            name = m.get(g) or m.get('*') or m.get(dg) or next(iter(m.values()))
            if name in idx['sets']:
                s = _usets.get(name)
                if s is None:
                    s = _usets[name] = USet(name, idx['sets'][name])
    _uset_of[key] = s
    return s


def face_dir(fx, fy, n=8):
    """Direction number 0..n-1 (angle d*360/n deg in world coordinates) by the look vector."""
    return int(round(math.atan2(fy, fx) * (n / math.tau))) % n


# ------------------------------------------------------------------ background preloading of unit sheets
# The first display of a new unit kind cost ~60 ms (reading a PNG + convert_alpha of the whole sheet in a frame). The sheets of kinds
# that players can train right now are decoded in advance in a background thread (PIL -> RGBA bytes), and in the main
# thread they are turned into surfaces in strips - no longer than the budget (~2 ms) per frame (pygame - only in the main one).
_pre_q = queue.Queue()
_pre_ready = collections.deque()
_pre_seen = set()
_pre_thread = [None]
_STRIP = 24             # sheet rows per copy step
# while the thread decodes a PNG, the main thread does not copy strips: otherwise every GIL release (blit) waits for the thread
# up to the switch interval (5 ms) and the frame budget is blown
_pre_busy = threading.Lock()


class _Pre:
    __slots__ = ('uset', 'rects', 'sheet', 'mask', 'size', 'msize', 'surf', 'msurf', 'row', 'mrow')

    def __init__(self, uset):
        self.uset = uset
        self.rects = self.sheet = self.mask = self.size = self.msize = self.surf = self.msurf = None
        self.row = self.mrow = 0


def _pre_worker():
    from PIL import Image
    while True:
        s = _pre_q.get()
        job = _Pre(s)
        _pre_busy.acquire()
        try:
            rec = s.rec
            with open(os.path.join(GEN, rec['meta']), encoding='utf-8') as f:
                job.rects = json.load(f)['frames']
            with Image.open(os.path.join(GEN, rec['file'])) as im:
                im = im.convert('RGBA')
                job.size, job.sheet = im.size, im.tobytes()
            if rec.get('mask'):
                with Image.open(os.path.join(GEN, rec['mask'])) as im:
                    im = im.convert('RGB')
                    job.msize, job.mask = im.size, im.tobytes()
        except (OSError, ValueError):
            job = None               # failed - the sheet will load the usual way on the first display
        finally:
            _pre_busy.release()
        if job is not None:
            _pre_ready.append(job)
        time.sleep(0.02)             # sheets one at a time, several game frames between them


def request(kind, civ, female=False):
    """Put a kind's sheet in the background preload queue (if not yet loaded)."""
    s = unit_set(kind, civ, female)
    if s is None or s.sheet is not None or s.name in _pre_seen:
        return
    _pre_seen.add(s.name)
    if _pre_thread[0] is None:
        t = threading.Thread(target=_pre_worker, name='unit-sheets', daemon=True)
        t.start()
        _pre_thread[0] = t
    _pre_q.put(s)


def _strips(job, data, size, rows_done, surf, mode, bpp, t_end):
    w, h = size
    while rows_done < h and time.perf_counter() < t_end:
        n = min(_STRIP, h - rows_done)
        part = pygame.image.frombuffer(data[rows_done * w * bpp:(rows_done + n) * w * bpp], (w, n), mode)
        surf.blit(part, (0, rows_done))
        rows_done += n
    return rows_done


def pump(budget=0.002):
    """The main thread, once per frame: turns ready bytes into surfaces, no longer than budget seconds."""
    if not _pre_ready or not _pre_busy.acquire(blocking=False):
        return
    try:
        _pump(budget)
    finally:
        _pre_busy.release()


def _pump(budget):
    t_end = time.perf_counter() + budget
    disp = pygame.display.get_surface() is not None
    while _pre_ready and time.perf_counter() < t_end:
        job = _pre_ready[0]
        s = job.uset
        if s.sheet is not None:             # managed to load the usual way
            _pre_ready.popleft()
            continue
        if job.surf is None:
            fmt = pygame.Surface((1, 1), pygame.SRCALPHA)
            if disp:
                fmt = fmt.convert_alpha()
            job.surf = pygame.Surface(job.size, pygame.SRCALPHA, fmt)
            return                          # creating a large surface is a separate step (a frame)
        if job.row < job.size[1]:
            job.row = _strips(job, job.sheet, job.size, job.row, job.surf, 'RGBA', 4, t_end)
            continue
        if job.mask is not None and job.mrow < job.msize[1]:
            if job.msurf is None:
                job.msurf = pygame.Surface(job.msize)
                if disp:
                    job.msurf = job.msurf.convert()
                return
            job.mrow = _strips(job, job.mask, job.msize, job.mrow, job.msurf, 'RGB', 3, t_end)
            continue
        s.rects = job.rects
        s.mask = job.msurf
        s.sheet = job.surf                  # last: _ensure() looks at sheet
        _pre_ready.popleft()


def preload_pending():
    """How many sheets are still in progress (for tests)."""
    return _pre_q.qsize() + len(_pre_ready)
