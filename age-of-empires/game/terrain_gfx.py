"""Ground with relief: blending of types by masks (like AoE2's blendomatic), lifting by heights and slope light.

The order of assembling the static ground surface (Game.build_terrain):
  1) flat isometry: water (color by depth) - as before;
  2) paint_ground - every land cell with its own texture (a diamond, the texture is a function of the world point, so
     there are no seams), then on top - "overlaps" of neighbors with a higher priority (PRIORITY in game/terrain.py):
     a mask per side (4) and per corner (4) with a noisy edge, the noise is periodic with the texture's period (4 cells) -
     ready overlaps are cached by (type, side, x mod 4, y mod 4);
  3) foam and other water details (naval_gfx.decorate);
  4) relief - a vertical shift of each pixel column by the ground height (an inverse mapping over a
     monotonic column) and multiplication by the slope light (normal . the sun at the upper right, like the sprite
     renderer tools/render3d/camera.py SUN). Flat areas are skipped in blocks.
The fog shift is the same, at the fog resolution (fog_rows).
"""
import math
import random

import numpy as np
import pygame

from .data import TILE, HW, HH
from . import terrain as tr

ZK = 32 * math.sqrt(2) * math.cos(math.radians(30))     # screen px per height cell at the sprite renderer (~39.2)
SUN = np.array([0.5, -0.55, 1.5], np.float32)
SUN /= np.linalg.norm(SUN)
LIGHT_K = 1.15          # brightness per unit of steepness toward / away from the sun (DE slopes are noticeably contrasty)
LIGHT_STEEP = 0.15
S = 4                   # the step of the coarse shift grid (px)

# the atlas texture for a ground type (with fallbacks)
TEX = {'grass': ('grass',), 'grass2': ('grass2', 'grass'), 'grass3': ('grass3', 'grass'), 'dirt': ('dirt',),
       'dirt2': ('dirt2', 'dirt'), 'dirt3': ('dirt3', 'grass3', 'grass'), 'forest': ('forest',),
       'pine': ('pine', 'forest'), 'sand': ('sand',), 'beach': ('beach', 'sand'), 'shallow': ('shallow', 'sand'),
       'rocky': ('rocky', 'dirt')}
SHALLOW_TINT = ((88, 200, 220), 0.74)      # shallows: the sand of the bottom under turquoise water (the water color by the shore)
BLEED = {'edge': 0.30, 'corner': 0.34}      # how far a type with a higher priority enters its neighbor (cells)
JITTER = 0.75
SOFT = 0.12

_DIRS = ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


# ============================================================ cell masks
def _diamond():
    """Local world coordinates (u, v) of the pixels of a 64x32 diamond (arrays (x, y)) and the "inside the cell" mask."""
    i = np.arange(2 * HW, dtype=np.float32)[:, None] + 0.5 - HW
    j = np.arange(2 * HH, dtype=np.float32)[None, :] + 0.5
    u = (i / HW + j / HH) * 0.5
    v = (j / HH - i / HW) * 0.5
    inside = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    return u, v, inside


def _periodic_noise(n, cells, rng):
    """Seamless n x n noise (the period = the size), 0..1."""
    g = rng.random((cells, cells)).astype(np.float32)
    t = np.arange(n, dtype=np.float32) * cells / n
    i0 = t.astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


class _Painter:
    def __init__(self, tiles):
        """tiles - {ground type: a Surface of an isometric tile (a period of 4 cells)}."""
        self.U, self.V, self.IN = _diamond()
        rng = np.random.default_rng(17)
        nz = _periodic_noise(256, 12, rng) * 0.65 + _periodic_noise(256, 28, rng) * 0.35
        self.nz = nz                          # [gy, gx] over 4x4 cells, 64 samples per cell
        self.src = {}
        for g, surf in tiles.items():
            a = pygame.surfarray.array3d(surf)
            self.src[g] = np.tile(a, (2, 2, 1))          # 2x2 tiles: cut-outs without wrapping
        self.tw = {g: s.get_width() for g, s in tiles.items()}
        self.base = {}
        self.ovl = {}

    def _crop(self, g, a, b):
        tw = self.tw[g]
        x = ((a - b) * HW - HW) % tw
        y = ((a + b) * HH) % (tw // 2)
        return self.src[g][x:x + 2 * HW, y:y + 2 * HH]

    def base_tile(self, g, a, b):
        k = (g, a, b)
        s = self.base.get(k)
        if s is None:
            c = self._crop(g, a, b).copy()
            c[~self.IN] = (255, 0, 255)
            s = pygame.surfarray.make_surface(c)
            s.set_colorkey((255, 0, 255), pygame.RLEACCEL)
            self.base[k] = s
        return s

    def overlay(self, g, d, a, b):
        k = (g, d, a, b)
        s = self.ovl.get(k)
        if s is None:
            U, V = self.U, self.V
            dx, dy = d
            ex = (1 - U) if dx > 0 else U
            ey = (1 - V) if dy > 0 else V
            if dx and dy:
                dist = np.sqrt(ex * ex + ey * ey)
                bleed = BLEED['corner']
            else:
                dist = ex if dx else ey
                bleed = BLEED['edge']
            gx = ((a + np.clip(U, 0, 0.999)) * 64).astype(int) % 256
            gy = ((b + np.clip(V, 0, 0.999)) * 64).astype(int) % 256
            n = self.nz[gy, gx] - 0.5
            al = np.clip((bleed + n * JITTER - dist) / SOFT + 0.5, 0, 1) * self.IN
            s = pygame.Surface((2 * HW, 2 * HH), pygame.SRCALPHA)
            pygame.surfarray.pixels3d(s)[...] = self._crop(g, a, b)
            pygame.surfarray.pixels_alpha(s)[...] = (al * 255).astype(np.uint8)
            self.ovl[k] = s
        return s


def load_tiles(tile_fn):
    """Texture tiles by ground types (tile_fn(name) -> Surface | None); None - no textures."""
    out = {}
    for g, names in TEX.items():
        t = None
        for n in names:
            t = tile_fn(n)
            if t is not None:
                break
        if t is None:
            if g in ('grass',):
                return None
            continue
        if g == 'shallow':
            t = t.copy()
            tint = pygame.Surface(t.get_size())
            tint.fill(SHALLOW_TINT[0])
            tint.set_alpha(int(255 * SHALLOW_TINT[1]))
            t.blit(tint, (0, 0))
        out[g] = t
    for g in TEX:
        if g not in out:
            out[g] = out['grass']
    return out


_AS_GRASS = ('grass2', 'grass3')       # grass shades are not separate cells but smooth patches (paint_grass_tones)


def paint_ground(big, w, ox, tiles):
    """Land and shallows cells - with the texture of their own type; smooth grass shades; at the edges - overlaps of
    neighbors with a higher priority (a side/corner, a noisy edge)."""
    p = _Painter(tiles)
    W, H = w.W, w.H
    gr = w.ground
    names = list(tr.GROUNDS)
    for n in _AS_GRASS:
        names[tr.G[n]] = 'grass'
    water = tr.G['water']
    prio = [0] * len(names)
    for i, n in enumerate(tr.PRIORITY):
        prio[tr.G[n]] = i
    for n in _AS_GRASS:
        prio[tr.G[n]] = prio[tr.G['grass']]
    blit = big.blit
    for ty in range(H):
        row = ty * W
        y0 = ty * HH
        x0 = ox - HW - ty * HW
        for tx in range(W):
            g = gr[row + tx]
            if g != water:
                blit(p.base_tile(names[g], tx & 3, ty & 3), (x0 + tx * HW, y0 + tx * HH))
    paint_grass_tones(big, w, ox, tiles)
    for ty in range(H):
        row = ty * W
        for tx in range(W):
            pg = prio[gr[row + tx]]
            hi = None
            for d in _DIRS:
                nx, ny = tx + d[0], ty + d[1]
                if 0 <= nx < W and 0 <= ny < H:
                    ng = gr[ny * W + nx]
                    if prio[ng] > pg:
                        if hi is None:
                            hi = {}
                        hi.setdefault(ng, []).append(d)
            if hi is None:
                continue
            x0 = (tx - ty) * HW + ox - HW
            y0 = (tx + ty) * HH
            a, b = tx & 3, ty & 3
            for ng in sorted(hi, key=prio.__getitem__):
                ds = hi[ng]
                name = names[ng]
                for d in ds:
                    if d[0] and d[1] and ((d[0], 0) in ds or (0, d[1]) in ds):
                        continue                # the corner is already covered by overlaps from the sides
                    blit(p.overlay(name, d, a, b), (x0, y0))
    # ripples on the shallows
    rnd = random.Random(23)
    shallow = tr.G['shallow']
    for ty in range(H):
        for tx in range(W):
            if gr[ty * W + tx] != shallow:
                continue
            for _ in range(2):
                wx = (tx + rnd.random()) * TILE
                wy = (ty + rnd.random()) * TILE
                ix, iy = wx - wy + ox, (wx + wy) * 0.5
                L = rnd.randint(4, 9)
                pygame.draw.line(big, (170, 222, 222), (int(ix), int(iy)), (int(ix + L), int(iy)), 1)
    return True


def _smooth_noise(W, H, cell, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((H // cell + 3, W // cell + 3)).astype(np.float32)
    ys = np.arange(H, dtype=np.float32) / cell
    xs = np.arange(W, dtype=np.float32) / cell
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = (ys - y0)[:, None]
    fx = (xs - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    return (g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx) * (1 - fy) + \
        (g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx) * fy


def _iso_mask(a, size):
    """A per-cell field (H, W) 0..1 -> an isometric alpha mask of size size (rotation and squeeze, like the minimap)."""
    H, W = a.shape
    s = pygame.image.frombuffer(np.ascontiguousarray(np.repeat((np.clip(a, 0, 1) * 255).astype(np.uint8)[..., None],
                                                               3, axis=2)).tobytes(), (W, H), 'RGB')
    sq = pygame.transform.smoothscale(s, (W * 6, H * 6))
    rot = pygame.transform.rotate(sq, -45)
    return pygame.transform.smoothscale(rot, size)


def paint_grass_tones(big, w, ox, tiles):
    """Grass shades (grass2 - darker, grass3 - drier) in smooth patches over grass far from other types."""
    W, H = w.W, w.H
    g = np.frombuffer(bytes(w.ground), np.uint8).reshape(H, W)
    grassy = np.isin(g, [tr.G['grass'], tr.G['grass2'], tr.G['grass3']]).astype(np.float32)
    # only deep inside the grass: overlaps of neighboring types are laid on top later
    inner = grassy.copy()
    inner[1:, :] *= grassy[:-1, :]
    inner[:-1, :] *= grassy[1:, :]
    inner[:, 1:] *= grassy[:, :-1]
    inner[:, :-1] *= grassy[:, 1:]
    tw, th = big.get_size()
    qs = (tw // 4, th // 4)
    for name, cell, seed, lo in (('grass2', 9, 31, 0.5), ('grass3', 6, 32, 0.56)):
        tile = tiles.get(name)
        if tile is None or tile is tiles.get('grass'):
            continue
        n = _smooth_noise(W, H, cell, seed)
        a = np.clip((n - lo) * 4.0, 0, 0.85) * inner
        if a.max() <= 0.02:
            continue
        m = _iso_mask(a, qs)
        layer = pygame.Surface((tw, th), pygame.SRCALPHA)
        tw0, th0 = tile.get_size()
        x0 = ox % tw0 - tw0                      # the same world anchoring as the _Painter cut-outs
        for y in range(0, th, th0):
            for x in range(x0, tw, tw0):
                layer.blit(tile, (x, y))
        alpha = pygame.Surface(qs, pygame.SRCALPHA)
        alpha.fill((255, 255, 255, 0))
        pygame.surfarray.pixels_alpha(alpha)[...] = pygame.surfarray.pixels3d(m)[..., 0]
        layer.blit(pygame.transform.smoothscale(alpha, (tw, th)), (0, 0), special_flags=pygame.BLEND_RGBA_MULT)
        big.blit(layer, (0, 0))


# ============================================================ relief and light
def _vertex_light(hz):
    """The light multiplier at vertices: 1 - flat ground, > 1 - a slope toward the sun, < 1 - away from it.
    Like AoE2's lighting maps: brightness linear in steepness along the sun's horizontal direction
    (the upper right of the screen), with a small contribution of steepness in general (any slope is slightly darker than a plain)."""
    h = hz / ZK                               # height in cells
    gx = np.zeros_like(h)
    gy = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    lx, ly = SUN[0], SUN[1]
    k = 1.0 / math.hypot(lx, ly)
    toward = -(gx * lx + gy * ly) * k         # > 0 - the slope faces the sun
    steep = np.sqrt(gx * gx + gy * gy)
    return np.clip(1.0 + LIGHT_K * toward - LIGHT_STEEP * steep, 0.5, 1.45)


def _bilinear(grid, fx, fy):
    """Sampling the vertex grid (H+1, W+1) at the points (fx, fy) (cells), beyond the edge - the edge."""
    Hh, Ww = grid.shape
    fx = np.clip(fx, 0, Ww - 1.001)
    fy = np.clip(fy, 0, Hh - 1.001)
    x0 = fx.astype(np.int32)
    y0 = fy.astype(np.int32)
    ax = fx - x0
    ay = fy - y0
    a = grid[y0, x0] * (1 - ax) + grid[y0, x0 + 1] * ax
    b = grid[y0 + 1, x0] * (1 - ax) + grid[y0 + 1, x0 + 1] * ax
    return a * (1 - ay) + b * ay


def _to_tiles(ix, iy, ox):
    """Isometry (flat) -> world cells."""
    x = (ix - ox + 2 * iy) * 0.5
    y = (2 * iy - (ix - ox)) * 0.5
    return x / TILE, y / TILE


class Relief:
    """A coarse inverse-shift grid: for a screen point (x, sy) - the flat-isometry row iy = sy + D."""

    def __init__(self, w, ox, tw, th):
        self.tw, self.th = tw, th
        hz = np.asarray(w.hz, np.float32)
        self.flat = not w.relief or float(hz.max()) <= 0.01
        nc = tw // S + 2
        nr = th // S + 2
        self.D = np.zeros((nr, nc), np.float32)
        self.L = np.ones((nr, nc), np.float32)
        if self.flat:
            return
        light = _vertex_light(hz)
        X = np.arange(nc, dtype=np.float32) * S
        Y = np.arange(nr + int(hz.max()) // S + 4, dtype=np.float32) * S
        fx, fy = _to_tiles(X[None, :], Y[:, None], ox)
        z = _bilinear(hz, fx, fy)
        sy = np.maximum.accumulate(Y[:, None] - z, axis=0)
        T = np.arange(nr, dtype=np.float32) * S
        iy = np.empty((nr, nc), np.float32)
        for c in range(nc):
            iy[:, c] = np.interp(T, sy[:, c], Y)
        self.D = iy - T[:, None]
        fx, fy = _to_tiles(X[None, :], iy, ox)
        self.L = _bilinear(light, fx, fy).astype(np.float32)

    def apply(self, surf, block=64):
        """Shift and light the ground surface in place (top to bottom: rows are taken only from below)."""
        if self.flat:
            return
        arr = pygame.surfarray.pixels3d(surf)           # (x, y, 3)
        tw, th = self.tw, self.th
        D, L = self.D, self.L
        bs = block // S
        for y0 in range(0, th, block):
            y1 = min(th, y0 + block)
            r0 = y0 // S
            for x0 in range(0, tw, block * 4):
                x1 = min(tw, x0 + block * 4)
                c0 = x0 // S
                c1 = min(D.shape[1] - 1, (x1 - 1) // S + 1)
                r1 = min(D.shape[0] - 1, r0 + bs)
                dblk = D[r0:r1 + 1, c0:c1 + 1]
                lblk = L[r0:r1 + 1, c0:c1 + 1]
                if dblk.max() < 0.5 and np.abs(lblk - 1).max() < 0.01:
                    continue
                ys = np.arange(y0, y1, dtype=np.float32)
                xs = np.arange(x0, x1, dtype=np.float32)
                ry = ys / S - r0
                cx = xs / S - c0
                iy0 = np.minimum(ry.astype(np.int32), dblk.shape[0] - 2)
                ix0 = np.minimum(cx.astype(np.int32), dblk.shape[1] - 2)
                fy = (ry - iy0)[None, :]
                fx = (cx - ix0)[:, None]
                # (x, y) order as in pixels3d
                Dt = dblk.T
                Lt = lblk.T
                d = (Dt[ix0][:, iy0] * (1 - fx) + Dt[ix0 + 1][:, iy0] * fx) * (1 - fy) + \
                    (Dt[ix0][:, iy0 + 1] * (1 - fx) + Dt[ix0 + 1][:, iy0 + 1] * fx) * fy
                lt = (Lt[ix0][:, iy0] * (1 - fx) + Lt[ix0 + 1][:, iy0] * fx) * (1 - fy) + \
                    (Lt[ix0][:, iy0 + 1] * (1 - fx) + Lt[ix0 + 1][:, iy0 + 1] * fx) * fy
                sf = ys[None, :] + d
                src = np.minimum(sf.astype(np.int32), th - 2)
                f = np.clip(sf - src, 0, 1)[..., None]
                xi = np.arange(x0, x1)[:, None]
                # between two rows - linear (otherwise row repeats are visible on slopes)
                px = arr[xi, src].astype(np.float32)
                px += (arr[xi, src + 1] - px) * f
                px *= lt[..., None]
                np.clip(px, 0, 255, out=px)
                arr[x0:x1, y0:y1] = px.astype(np.uint8)
        del arr

    def fog_rows(self, fw, fh, fs):
        """For fog at 1/fs resolution: the source row (fw, fh) of each fog pixel (or None)."""
        if self.flat:
            return None
        k = fs // S
        d = self.D[::k, ::k][:fh, :fw] / fs
        rows = np.arange(fh, dtype=np.float32)[:, None] + d
        full = np.zeros((fh, fw), np.float32)
        full[:rows.shape[0], :rows.shape[1]] = rows
        if rows.shape[0] < fh or rows.shape[1] < fw:
            full[rows.shape[0]:, :] = np.arange(rows.shape[0], fh, dtype=np.float32)[:, None]
        return np.minimum((full + 0.5).astype(np.int32), fh - 1).T.copy()     # (x, y)


def warp_fog(fog, rows):
    """Shift the fog alpha up along the relief (rows - from Relief.fog_rows)."""
    if rows is None:
        return
    a = pygame.surfarray.pixels_alpha(fog)
    if a.shape != rows.shape:
        del a
        return
    xi = np.arange(a.shape[0])[:, None]
    a[...] = a[xi, rows]
    del a


# ============================================================ minimap
def minimap_colors(w, water_color, depth, de=False):
    """Cell colors by ground type, lighter at higher levels (as in AoE2), water - by depth.
    de=False - the world backing under the textures (the former palette, in which the world's water is visible too);
    de=True - the minimap in the AoE II DE palette taking the landscape into account (game/themes.py): grass #00A900,
    water #004ABB, shallows #305DB6, cliff #714B33."""
    from . import themes
    W, H = w.W, w.H
    out = []
    gr = w.ground
    em = w.elev_map
    names = tr.GROUNDS
    if de:
        pal = [themes.mm_color(w, n) for n in names]
    else:
        pal = [tr.MM_COLOR[n] for n in names]
    for y in range(H):
        row = []
        for x in range(W):
            t = w.terrain[y][x]
            if t == tr.WATER:
                if de:
                    row.append(themes.MM_WATER_NEAR if depth[y][x] <= 1 else themes.MM_WATER)
                else:
                    row.append(water_color(depth[y][x]))
                continue
            c = pal[gr[y * W + x]]
            if t == tr.CLIFF:
                c = themes.MM_CLIFF if de else (116, 100, 82)
            k = 1.0 + (0.04 if de else 0.06) * em[y * W + x]
            row.append(tuple(max(0, min(255, int(v * k))) for v in c))
        out.append(row)
    return out
