"""Офлайн-рендер моделей 0 A.D. в изометрические спрайты игры.

Быстрый старт:
    from tools.render3d import Renderer, resolve, fit_to_footprint, render_parts
    r = Renderer(ss=3)
    parts = resolve('structures/britons/house.xml', seed=0)          # актор → детали (меш + матрица)
    spr = render_parts(r, parts, footprint=2)                          # вписать в 2×2 клетки
    spr.rgba, spr.mask, spr.ox, spr.oy                                 # RGBA, маска цвета игрока, якорь

Модули:
    assets   — пути к сырым ассетам, текстуры (DDS→PNG, кэш), COLLADA → numpy (кэш .npz)
    actor    — XML акторов: варианты, пропы, материалы → list[Part]
    camera   — проекция игры (ромб 64×32, 30°), солнце, матрица размещения модели на земле
    renderer — moderngl: карта теней, тень на земле, маска цвета игрока, сверхвыборка
"""
import numpy as np

from . import assets, camera
from .actor import Part, resolve, actor_exists
from .renderer import Renderer, Sprite, Look

__all__ = ['assets', 'camera', 'Part', 'resolve', 'actor_exists', 'Renderer', 'Sprite', 'Look',
           'parts_bounds', 'fit_to_footprint', 'render_parts']


def parts_bounds(parts, z_min=-0.05, include_decals=False):
    """Габариты деталей в координатах модели: (min xyz, max xyz) по вершинам выше z_min (над землёй)."""
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
    """Матрица размещения: модель поворачивается на yaw и масштабируется так, чтобы её габарит по земле
    занял долю fill квадрата size×size клеток; центр габарита — в центре квадрата.
    Возвращает (матрица, масштаб)."""
    if bounds is None:
        pl0 = camera.placement(1.0, yaw, mirror=mirror)
        lo, hi = parts_bounds([Part(p.mesh, pl0 @ p.matrix, p.textures, p.material, p.actor, p.decal)
                               for p in parts])
    else:
        lo, hi = bounds
    ext = max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
    s = scale if scale is not None else fill * size / ext
    c = center if center is not None else (size / 2, size / 2)
    # центр габарита (в повёрнутых координатах) → центр основания
    base = camera.placement(s, yaw, mirror=mirror)
    mc = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, 0.0])
    T = np.eye(4)
    T[:2, 3] = [c[0] - mc[0] * s, c[1] - mc[1] * s]
    return T @ base, s


def render_parts(r, parts, footprint, fill=0.94, yaw=0.0, mirror=False, place=None, **kw):
    """Детали → Sprite, вписанный в основание footprint×footprint клеток (или с готовой матрицей place)."""
    if place is None:
        place, _ = fit_to_footprint(parts, footprint, fill, yaw, mirror)
    items = Renderer.build_items(parts, place)
    return r.render(items, footprint=(footprint, footprint), **kw)
