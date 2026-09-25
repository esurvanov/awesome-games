"""Small world graphics from 0 A.D. (assets/gen/decals/, the index assets/gen/nature_extra.json - tools/build_decals.py):
fish and circles on the water, carcasses, stumps, rubble, fire and smoke, explosions, projectiles.

Each function returns (surface, ax, ay) - a frame and the pixel of the "point on the ground" in it (draw at sx - ax, sy - ay)
or None if there are no sprites (then the game draws the former procedural graphics).
"""
import json
import math
import os

import pygame

GEN = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'gen')

_idx = None
_tried = False
_sheets = {}
_frames = {}
_faded = {}
_FADED_MAX = 4000


def index():
    global _idx, _tried
    if not _tried:
        _tried = True
        if os.environ.get('NO_SPRITES3D') or os.environ.get('NO_SPRITES_EXTRA'):
            return None
        try:
            with open(os.path.join(GEN, 'nature_extra.json'), encoding='utf-8') as f:
                _idx = json.load(f).get('groups') or None
        except (OSError, ValueError):
            _idx = None
    return _idx


def group(name):
    ix = index()
    return ix.get(name) if ix else None


def frame(name, i):
    """(surface, ax, ay) of frame i of group name; None - no such group."""
    key = (name, i)
    hit = _frames.get(key)
    if hit is not None:
        return hit
    g = group(name)
    if g is None:
        return None
    sh = _sheets.get(name)
    if sh is None:
        sh = pygame.image.load(os.path.join(GEN, g['file']))
        if pygame.display.get_surface() is not None:
            sh = sh.convert_alpha()
        _sheets[name] = sh
    fr = g['frames']
    x, y, w, h, ax, ay = fr[i % len(fr)]
    hit = _frames[key] = (sh.subsurface((x, y, w, h)), ax, ay)
    return hit


def faded(name, i, alpha):
    """A frame with an overall transparency alpha (0..255, quantized by 16) - for fading rubble, stumps, fish."""
    a = max(0, min(255, int(alpha))) & ~15
    if a >= 240:
        return frame(name, i)
    key = (name, i, a)
    hit = _faded.get(key)
    if hit is None:
        f = frame(name, i)
        if f is None:
            return None
        s = f[0].copy()
        s.fill((255, 255, 255, a), special_flags=pygame.BLEND_RGBA_MULT)
        if len(_faded) > _FADED_MAX:
            _faded.clear()
        hit = _faded[key] = (s, f[1], f[2])
    return hit


def blit(scr, fr, sx, sy):
    if fr is not None:
        s, ax, ay = fr
        scr.blit(s, (int(sx) - ax, int(sy) - ay))


# ------------------------------------------------------------------ fish and water
def fish(kind, var, t, alpha=255):
    """A fish frame: kind 'shore_fish' | 'deep_fish'; the swimming animation is looped."""
    name = 'fish_deep' if kind == 'deep_fish' else 'fish_shore'
    g = group(name)
    if g is None:
        return None
    n, nv = g['n'], g['vars']
    k = int((t / g['dur']) * n + var * 3) % n
    return faded(name, (var % nv) * n + k, alpha)


def ripple(t):
    g = group('ripple')
    if g is None:
        return None
    return frame('ripple', int(t / g['dur'] * g['n']) % g['n'])


# ------------------------------------------------------------------ carcasses
def carcass(kind, frac, fx, fy):
    """A carcass by the share of meat left frac: > 2/3 - whole, > 1/3 - butchered, otherwise - a skeleton;
    the direction - by the look (fx, fy) and the group's number of directions (16, 8 in old builds)."""
    name = 'carcass_' + kind
    g = group(name)
    if g is None:
        return None
    from .sprites3d import face_dir
    st = 0 if frac > 0.67 else 1 if frac > 0.34 else 2
    return frame(name, st * g['dirs'] + face_dir(fx, fy, g['dirs']))


# ------------------------------------------------------------------ stumps
_SPECIES_W = (('oak', 5), ('beech', 3), ('deci', 3), ('birch', 2), ('pine', 3), ('fir', 3), ('poplar', 1))


def _hash(x, y, s=0):
    h = (x * 73856093) ^ (y * 19349663) ^ (s * 83492791)
    return (h ^ (h >> 13)) & 0x7fffffff


def species(tx, ty):
    """The tile's tree species - the same patch layout as game.sprites3d.tree."""
    rx, ry = tx // 7, ty // 7
    if _hash(tx, ty, 5) % 4 == 0:
        rx, ry = (tx + 3) // 7, (ty + 3) // 7
    tot = sum(w for _, w in _SPECIES_W)
    r = _hash(rx, ry, 1) % tot
    sp = _SPECIES_W[0][0]
    for n, w in _SPECIES_W:
        if r < w:
            sp = n
            break
        r -= w
    if _hash(tx, ty, 9) % 5 == 0:
        sp = _SPECIES_W[_hash(tx, ty, 11) % len(_SPECIES_W)][0]
    return sp


def stump(tx, ty, alpha=255):
    g = group('stump')
    if g is None:
        return None
    sp = species(tx, ty)
    names = g['species']
    si = names.index(sp) if sp in names else 0
    return faded('stump', si * g['vars'] + _hash(tx, ty, 3) % g['vars'], alpha)


# ------------------------------------------------------------------ rubble, fire, explosion
WOOD = frozenset({'house', 'mill', 'lumber_camp', 'mining_camp', 'farm', 'dock', 'palisade_wall', 'palisade_gate',
                  'stable'})


def rubble(size, kind=None, alpha=255):
    name = 'rubble_wood' if kind in WOOD else 'rubble_stone'
    g = group(name)
    if g is None:
        return None
    sizes = g['sizes']
    i = min(range(len(sizes)), key=lambda j: abs(sizes[j] - size))
    return faded(name, i, alpha)


def _loop(name, t, phase=0.0, alpha=255):
    g = group(name)
    if g is None:
        return None
    k = int((t / g['dur'] + phase) * g['n']) % g['n']
    return faded(name, k, alpha) if alpha < 240 else frame(name, k)


def flame(t, phase=0.0, alpha=255):
    return _loop('flame', t, phase, alpha)


def smoke(t, phase=0.0, alpha=255):
    return _loop('smoke', t, phase, alpha)


def blast(age):
    """An explosion frame after age seconds; None - the explosion is over (or there are no sprites)."""
    g = group('blast')
    if g is None or age < 0 or age >= g['dur']:
        return None
    return frame('blast', int(age / g['dur'] * g['n']))


# ------------------------------------------------------------------ projectiles
def projectile(shape, dx, dy, t=0.0):
    """A projectile flying across the screen in the direction (dx, dy): 'arrow' | 'bolt' | 'javelin' - by direction,
    'stone' | 'ball' | 'shot' - a tumbling stone/cannonball."""
    name = 'proj_' + shape
    g = group(name)
    if g is None:
        return None
    if 'dirs' in g:
        n = g['dirs']
        return frame(name, int(round(math.atan2(dy, dx) / (2 * math.pi) * n)) % n)
    return frame(name, int(t * 12) % g['n'])
