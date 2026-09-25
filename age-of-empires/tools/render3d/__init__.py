"""Offline rendering of 0 A.D. models into the game's isometric sprites.

Quick start:
    from tools.render3d import Renderer, resolve, fit_to_footprint, render_parts
    r = Renderer(ss=3)
    parts = resolve('structures/britons/house.xml', seed=0)          # an actor -> parts (a mesh + a matrix)
    spr = render_parts(r, parts, footprint=2)                          # fit into 2x2 cells
    spr.rgba, spr.mask, spr.ox, spr.oy                                 # RGBA, the player color mask, the anchor

Modules:
    assets   - paths to raw assets, textures (DDS->PNG, a cache), COLLADA -> numpy (a .npz cache)
    actor    - actor XML: variants, props, materials -> list[Part]
    camera   - the game's projection (a 64x32 diamond, 30 deg), the sun, the matrix for placing a model on the ground
    renderer - moderngl: a shadow map, a shadow on the ground, the player color mask, supersampling
"""
import numpy as np

from . import assets, camera
from .actor import Part, resolve, actor_exists
from .renderer import Renderer, Sprite, Look

__all__ = ['assets', 'camera', 'Part', 'resolve', 'actor_exists', 'Renderer', 'Sprite', 'Look',
           'parts_bounds', 'fit_to_footprint', 'render_parts']


def parts_bounds(parts, z_min=-0.05, include_decals=False):
    """The footprint of parts in model coordinates: (min xyz, max xyz) over the vertices above z_min (above the ground)."""
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for p in parts:
        if p.is_decal:
            continue
        m = p.geom if p.geom is not None else assets.mesh(p.mesh)
        if m is None:
            continue
        v = (np.c_[m['pos'], np.ones(len(m['pos']))] @ p.matrix.T)[:, :3]
        v = v[v[:, 2] >= z_min]
        if len(v):
            lo = np.minimum(lo, v.min(0))
            hi = np.maximum(hi, v.max(0))
    if not np.isfinite(lo).all():
        lo, hi = np.zeros(3), np.ones(3)
    return lo, hi


def fit_to_footprint(parts, size, fill=0.94, yaw=0.0, mirror=False, bounds=None, scale=None, center=None):
    """A placement matrix: the model is rotated by yaw and scaled so that its footprint on the ground
    takes the share fill of a size x size square of cells; the footprint's center - at the square's center.
    Returns (matrix, scale)."""
    if bounds is None:
        pl0 = camera.placement(1.0, yaw, mirror=mirror)
        lo, hi = parts_bounds([Part(p.mesh, pl0 @ p.matrix, p.textures, p.material, p.actor, p.decal)
                               for p in parts])
    else:
        lo, hi = bounds
    ext = max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    s = scale if scale is not None else fill * size / ext
    c = center if center is not None else (size / 2, size / 2)
    # the footprint's center (in rotated coordinates) -> the base's center
    base = camera.placement(s, yaw, mirror=mirror)
    mc = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0])
    T = np.eye(4)
    T[:2, 3] = [c[0] - mc[0] * s, c[1] - mc[1] * s]
    return T @ base, s


def render_parts(r, parts, footprint, fill=0.94, yaw=0.0, mirror=False, place=None, **kw):
    """Parts -> a Sprite fitted into a footprint x footprint base of cells (or with a ready placement matrix place)."""
    if place is None:
        place, _ = fit_to_footprint(parts, footprint, fill, yaw, mirror)
    items = Renderer.build_items(parts, place)
    return r.render(items, footprint=(footprint, footprint), **kw)
