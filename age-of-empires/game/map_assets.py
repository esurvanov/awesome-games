"""Landscape graphics of the maps (assets/gen/maps/, index maps.json - tools/build_map_assets.py).

Loaded lazily; no files - the functions return None and the game draws its former look (the sprites3d atlas).
  tile_fn(w)            - a function "terrain type name -> tile" for terrain_gfx.load_tiles taking the landscape into account
  tree(w, tx, ty, var)  - (surface, ox, oy) of a landscape tree; None - let sprites3d.tree draw it
  animal(kind, var, face) - (surface, ox, oy) of an animal missing from the atlas (the wolf)
  relic()               - (surface, ox, oy) of a relic; (ox, oy) is the top corner of the tile's diamond
"""
import json
import math
import os

import pygame

from . import themes, sprites3d

GEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'gen')
_idx = None
_tried = False
_img = {}
_spr = {}
_tiles = {}
# the foliage of own species is already brought to the DE green at build time (tools/build_map_assets.py LEAF_TONE);
# the atlas species (oak, pine...) in a foreign landscape - as in sprites3d.tree (_greener)
_GREEN = ()


def index():
    global _idx, _tried
    if not _tried:
        _tried = True
        if os.environ.get('NO_SPRITES3D'):
            return None
        try:
            with open(os.path.join(GEN, 'maps', 'maps.json'), encoding='utf-8') as f:
                _idx = json.load(f)
        except (OSError, ValueError):
            _idx = None
    return _idx


def _load(rel, alpha=True):
    s = _img.get(rel)
    if s is None:
        s = pygame.image.load(os.path.join(GEN, rel))
        if pygame.display.get_surface() is not None:
            s = s.convert_alpha() if alpha else s.convert()
        _img[rel] = s
    return s


def _sprite(rec, green=False):
    key = (rec['file'], green)
    hit = _spr.get(key)
    if hit is None:
        s = _load(rec['file'])
        if green:
            s = sprites3d._greener(s)
        hit = _spr[key] = (s, rec['ox'], rec['oy'])
    return hit


# ------------------------------------------------------------------ ground
def terrain_tile(name):
    ix = index()
    rec = ix and ix.get('terrain', {}).get(name)
    if not rec:
        return None
    t = _tiles.get(name)
    if t is None:
        t = _tiles[name] = _load(rec['file'], alpha=False)
    return t


def tile_fn(w):
    """For terrain_gfx.load_tiles: terrain type -> a landscape tile (none - the atlas tile)."""
    tex = themes.of(w)['tex']

    def fn(name):
        alias = tex.get(name)
        if alias:
            t = terrain_tile(alias) or sprites3d.terrain_tile(alias)
            if t is not None:
                return t
        return sprites3d.terrain_tile(name)
    return fn


# ------------------------------------------------------------------ trees
def tree(w, tx, ty, var):
    """A tree of the match's landscape; None - the default landscape or no sprites (sprites3d.tree draws it)."""
    if themes.key_of(w) == themes.DEFAULT:
        return None
    ix = index() or {}
    own = ix.get('trees', {})
    base = sprites3d._nat_list('trees') or {}
    avail = {n for n in own if own[n]} | {n for n in base if base[n]}
    sp = themes.tree_species(w, tx, ty, avail)
    if sp is None:
        return None
    if own.get(sp):
        lst = own[sp]
        return _sprite(lst[(sprites3d._hash(tx, ty, 3) + var) % len(lst)], sp in _GREEN)
    lst = base[sp]
    rec = lst[(sprites3d._hash(tx, ty, 3) + var) % len(lst)]
    return _sprite(rec, True)


# ------------------------------------------------------------------ animals and relic
def animal(kind, var, face):
    ix = index()
    vs = ix and ix.get('animals', {}).get(kind)
    if not vs:
        return None
    dirs = vs[var % len(vs)]
    d = int(round(math.atan2(face[1], face[0]) / (math.pi / 4))) % 8
    return _sprite(dirs[d % len(dirs)])


def relic():
    ix = index()
    rec = ix and ix.get('relic')
    if not rec:
        return None
    return _sprite(rec)
