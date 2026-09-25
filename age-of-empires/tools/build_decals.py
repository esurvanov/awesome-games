#!/usr/bin/env python3
"""Small world graphics from 0 A.D. -> assets/gen/decals/ (+ assets/gen/nature_extra.json).

What used to be drawn with circles and lines: fish and rings on the water, animal carcasses (as they are butchered),
stumps of cut trees, building rubble, fire and smoke of burning buildings, explosions, projectiles (arrows, bolts,
javelins, stones, cannonballs). The models are rendered by the same tools/render3d as buildings; fire, smoke, rings on the water
and flashes are frames of an offline particle simulation on 0 A.D. textures (art/textures/particles, parameters -
from art/particles/*.xml).

  .venv/bin/python tools/build_decals.py                    # everything
  .venv/bin/python tools/build_decals.py --only fish,fire   # separate groups (the rest - from the old index)
  .venv/bin/python tools/build_decals.py --sheet shots/decals.png   # + a contact sheet

The result (paths relative to assets/gen/):
  nature_extra.json        - the index: group -> {'file': a PNG sheet, 'frames': [[x, y, w, h, ax, ay], ...], ...}
                             (ax, ay) - the frame pixel where the object's "ground point" falls
  decals/<group>.png       - the group's frame sheet (RGBA)
Groups: fish_shore, fish_deep (variant x frame), ripple (frames), carcass_<animal> (stage x direction),
stump (species x variant), rubble_<material> (size 1..4), flame, smoke, blast (frames),
proj_<kind> (16 directions on screen; stone/ball - rotation frames).
Derived 0 A.D. materials (c) Wildfire Games, CC BY-SA 3.0 (see CREDITS.md).
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

from tools.render3d import Renderer, resolve, parts_bounds, camera, assets  # noqa: E402
from tools.render3d import animactor as aa  # noqa: E402
from tools.render3d.actor import Part  # noqa: E402

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GEN = os.path.join(REPO, 'assets', 'gen')
OUT = os.path.join(GEN, 'decals')
INDEX = os.path.join(GEN, 'nature_extra.json')
PART = assets.art('textures', 'particles')

# scales - like the neighboring builders (tools/build_nature.py, tools/build_units.py)
UNITS_PER_TILE = 7.5            # buildings and nature: 0 A.D. units per cell
S_ANIMAL = 0.12                 # animals (like S_ANIMAL in build_units)
FWD = 90.0                      # the 0 A.D. model looks along -Y
MIRROR = True
PX_UNIT = camera.ZK / UNITS_PER_TILE     # screen pixels per 0 A.D. height unit (~ 5.2)

# the game's water (game/naval_gfx.py: SHALLOW, DEEP) - fish are tinted by the water column
SHALLOW = (72, 150, 190)
DEEP = (30, 70, 138)

_R = None


def R():
    global _R
    if _R is None:
        _R = Renderer(ss=4, shadow_res=1024)
    return _R


class Frame:
    """A frame: RGBA (H, W, 4) uint8 and the anchor (ax, ay)."""
    __slots__ = ('rgba', 'ax', 'ay')

    def __init__(self, rgba, ax, ay):
        self.rgba, self.ax, self.ay = rgba, int(ax), int(ay)


def _spr(s):
    return Frame(s.rgba, s.ox, s.oy)


def _crop(rgba, ax, ay, thr=2):
    ys, xs = np.nonzero(rgba[..., 3] > thr)
    if not len(xs):
        return Frame(np.zeros((1, 1, 4), np.uint8), 0, 0)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    return Frame(np.ascontiguousarray(rgba[y0:y1, x0:x1]), ax - x0, ay - y0)


# ================================================================== fish
def _water(fr, col, k, alpha):
    """'Under water': the color blends with the column's color, the opacity drops."""
    a = fr.rgba.astype(np.float32)
    c = np.array(col, np.float32)
    a[..., :3] = a[..., :3] * (1 - k) + c * k
    a[..., 3] *= alpha
    return Frame(np.clip(a, 0, 255).astype(np.uint8), fr.ax, fr.ay)


def _render_tree_frame(parts, scale, yaw, z0=0.0, ground=False, **kw):
    lo, hi = parts_bounds(parts, z_min=-1e9)
    mc = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
    place = camera.placement(scale, yaw, center=(0.0, 0.0), model_center=mc, z0=z0 - lo[2] * scale)
    items = Renderer.build_items(parts, place)
    return _spr(R().render(items, footprint=(0, 0), ground=ground, pad=1, **kw))


def build_fish():
    """Schools by the shore (fish_generic, three swimming animations) and large fish in the deep (fish_single)."""
    out = {}
    nfr = 8
    # by the shore: a school ~ 0.8 of a cell
    tree = aa.build('fauna/fish_generic.xml', 'idle', skip=lambda a, ap: 'seagull' in a)
    frames = []
    lo, hi = parts_bounds(aa.evaluate(tree, 0.0), z_min=-1e9)
    s = 1.05 / max(hi[0] - lo[0], hi[1] - lo[1])
    # school animations in which the fish do not gather at one point (with idle_b the school "collapses")
    picks = []                      # school animations that really move (idle_c in 0 A.D. is static)
    for v in range(3):
        t = aa.build('fauna/fish_generic.xml', 'idle', skip=lambda a, ap: 'seagull' in a, pick=v)
        g0, g1 = aa.evaluate(t, 0.0)[0].geom['pos'], aa.evaluate(t, 0.5)[0].geom['pos']
        if np.abs(g0 - g1).max() > 1e-3:
            picks.append(t)
    picks = picks or [tree]
    for v in range(3):
        t = picks[v % len(picks)]
        for k in range(nfr):
            fr = _render_tree_frame(aa.evaluate(t, k / nfr), s, 35.0 + v * 110.0)
            frames.append(_water(fr, (18, 50, 72), 0.5, 0.92))
    out['fish_shore'] = dict(frames=frames, n=nfr, vars=3, dur=1.4)
    # deep-water: two or three large fish side by side (they swim across the screen - so the silhouette reads)
    t = aa.build('fauna/fish_single.xml', 'walk')
    frames = []
    for v in range(2):
        for k in range(nfr):
            ps = []
            fish = [(-0.9, 0.5, 45 - 12), (0.8, -0.3, 225 + 10), (-0.1, -1.2, 45 + 15)][:2 + v]
            for j, (px, py, yaw) in enumerate(fish):
                M = camera.placement(1.0, yaw, center=(px, py))
                for p in aa.evaluate(t, ((k / nfr) + j * 0.37) % 1.0):
                    ps.append(Part(p.mesh, M @ p.matrix, p.textures, p.material, p.actor, p.decal, p.tags, p.geom))
            fr = _render_tree_frame(ps, 1.5 / 2.6, 0.0)
            frames.append(_water(fr, (10, 26, 60), 0.55, 0.9))
    out['fish_deep'] = dict(frames=frames, n=nfr, vars=2, dur=1.0)
    return out


# ================================================================== particles (offline simulation)
def _ptex(name, soft=0.0, gain=1.0):
    """A particle texture; soft > 0 - a round soft mask (flame*.png has opaque square corners);
    gain - alpha amplification (0 A.D. smoke is very transparent: there are dozens of particles, ours are a few)."""
    im = Image.open(os.path.join(PART, name)).convert('RGBA')
    if soft or gain != 1.0:
        a = np.asarray(im, np.float32)
        a[..., 3] = np.clip(a[..., 3] * gain, 0, 255)
        n = a.shape[0]
        y, x = np.mgrid[0:n, 0:a.shape[1]].astype(np.float32)
        rr = np.hypot(x - a.shape[1] / 2 + 0.5, y - n / 2 + 0.5) / (n / 2)
        if soft:
            a[..., 3] *= np.clip((1 - rr) / soft, 0, 1)
        im = Image.fromarray(a.astype(np.uint8))
    return im


def _stamp(acc, img, cx, cy, size, angle, color, mode, alpha=1.0, squash=1.0):
    """Draw a particle (PIL RGBA) into the buffer acc (H, W, 4 float, premultiplied)."""
    sz = max(1, int(round(size)))
    im = img.resize((sz, max(1, int(round(sz * squash)))), Image.BILINEAR)
    if angle:
        im = im.rotate(math.degrees(angle), resample=Image.BILINEAR, expand=True)
    a = np.asarray(im, np.float32) / 255.0
    h, w = a.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    H, W = acc.shape[:2]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sx1, sy1 = min(w, W - x0), min(h, H - y0)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    src = a[sy0:sy1, sx0:sx1]
    dst = acc[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1]
    col = np.array(color[:3], np.float32)
    if mode == 'add':
        # additive: the color contribution = rgb*a
        c = src[..., :3] * col * (src[..., 3:4] * alpha)
        dst[..., :3] += c
        dst[..., 3] += c.max(axis=2)
    else:
        al = src[..., 3:4] * alpha
        dst[..., :3] = src[..., :3] * col * al + dst[..., :3] * (1 - al)
        dst[..., 3:4] = al + dst[..., 3:4] * (1 - al)


def _finish(acc, ss, ax, ay):
    """A premultiplied buffer (supersampling ss) -> a Frame (a straight alpha channel)."""
    H, W = acc.shape[:2]
    a = acc.reshape(H // ss, ss, W // ss, ss, 4).mean(axis=(1, 3))
    al = np.clip(a[..., 3:4], 0, 1)
    rgb = np.where(al > 1e-3, a[..., :3] / np.maximum(al, 1e-3), 0)
    out = np.concatenate([np.clip(rgb, 0, 1) * 255, al * 255], axis=2).round().astype(np.uint8)
    return _crop(out, ax / ss, ay / ss)


def _periodic(rng, n, fn):
    """n particles with parameters fn(rng) - identical for every period (a looped animation)."""
    return [fn(rng) for _ in range(n)]


def _loop_frames(ps, F, T, W, H, draw, ss, ax, ay):
    """Frames of a looped particle system: particle i lives in every period T (t0 + m*T), draw(acc, age, p)."""
    frames = []
    for f in range(F):
        t = f / F * T
        acc = np.zeros((H, W, 4), np.float32)
        items = []
        for p in ps:
            for m in (-2, -1, 0, 1):
                age = t - (p['t0'] + m * T)
                if 0 <= age < p['life']:
                    items.append((age, p))
        items.sort(key=lambda x: -x[0])          # the old ones (above) - behind
        for age, p in items:
            draw(acc, age, p)
        frames.append(_finish(acc, ss, ax, ay))
    return frames


def build_flame():
    """Flame: flame.png particles (additive), after art/particles/flame.xml (~20/s, life ~1 s, rise 2-2.5 units/s,
    size 1-2 units), but taller and narrower - tongues above the roof. The anchor is the flame's base."""
    ss, F, T = 3, 16, 1.6
    W, H = 50 * ss, 90 * ss
    ax, ay = W // 2, H - 6 * ss
    tex = _ptex('flame.png', soft=0.35)
    rng = np.random.default_rng(7)
    k = 1.8 * PX_UNIT * ss            # pixels (of supersampling) per 0 A.D. unit; larger than in 0 A.D. - visible from afar
    ps = _periodic(rng, int(26 * T), lambda r: dict(
        t0=r.uniform(0, T), life=r.uniform(0.7, 1.15), x=r.normal(0, 0.35), vx=r.uniform(-0.25, 0.25),
        vy=r.uniform(3.0, 3.9), size=r.uniform(1.5, 2.3), ang=r.uniform(-0.5, 0.5), va=r.uniform(-0.8, 0.8),
        c=r.uniform(0.8, 1.0), ph=r.uniform(0, 6.3)))

    def draw(acc, age, p):
        u = age / p['life']
        fade = min(1.0, u * 8) * (1 - u) ** 0.9
        x = ax + (p['x'] * (1 - 0.6 * u) + p['vx'] * age + 0.25 * math.sin(p['ph'] + age * 7) * u) * k
        y = ay - (p['vy'] * age) * k * 0.9
        size = p['size'] * k * (1.0 - 0.7 * u)
        c = p['c']
        _stamp(acc, tex, x, y, size, p['ang'] + p['va'] * age, (c, c * (0.92 - 0.3 * u), c * (0.85 - 0.6 * u)),
               'add', fade)
    return {'flame': dict(frames=_loop_frames(ps, F, T, W, H, draw, ss, ax, ay), n=F, dur=T)}


def build_smoke():
    """Smoke over a fire: smoke_128a/smoke_64a ("over"), a dark-grey column, grows and is blown to the right by the wind."""
    ss, F, T = 2, 16, 3.2
    W, H = 80 * ss, 130 * ss
    ax, ay = 24 * ss, H - 6 * ss
    texs = [_ptex('smoke_128a.png', 0.3, 4.0), _ptex('smoke_64a.png', 0.3, 4.5)]
    rng = np.random.default_rng(11)
    k = 1.2 * PX_UNIT * ss
    ps = _periodic(rng, int(9 * T), lambda r: dict(
        t0=r.uniform(0, T), life=r.uniform(3.6, 4.4), x=r.uniform(-0.3, 0.3), vx=r.uniform(0.4, 0.9),
        vy=r.uniform(3.0, 3.6), size=r.uniform(1.4, 2.0), ang=r.uniform(-3.1, 3.1), va=r.uniform(-1, 1),
        c=r.uniform(0.26, 0.36), tex=int(r.integers(0, 2))))

    def draw(acc, age, p):
        u = age / p['life']
        fade = min(1.0, u * 5) * (1 - u) ** 1.1 * 1.9
        x = ax + (p['x'] + p['vx'] * age * (0.4 + u)) * k
        y = ay - (p['vy'] * age * (1 - 0.3 * u)) * k * 0.9
        size = p['size'] * k * (1 + 2.2 * u)
        c = p['c'] + 0.3 * u
        _stamp(acc, texs[p['tex']], x, y, size, p['ang'] + p['va'] * age, (c, c, c * 0.97), 'over', min(1, fade))
    return {'smoke': dict(frames=_loop_frames(ps, F, T, W, H, draw, ss, ax, ay), n=F, dur=T)}


def build_blast():
    """An explosion (projectiles with a radius, fire ships): a flash_radiant flash, flame.png fireballs fly apart,
    puffs of smoke and dust, a ring.png shock ring along the ground. 12 frames over 1.2 s, the anchor is the point of impact on the ground."""
    ss, F, T = 2, 12, 1.2
    W, H = 150 * ss, 110 * ss
    ax, ay = W // 2, H - 26 * ss
    fl, rad, ring = _ptex('flame.png', 0.35), _ptex('flame_radiant.png', 0.6), _ptex('ring.png')
    smk, dust, shr = _ptex('smoke_128a.png'), _ptex('dust.png'), _ptex('stone_shrapnel.png')
    rng = np.random.default_rng(5)
    balls = [dict(a=rng.uniform(0, 2 * math.pi), v=rng.uniform(20, 42), up=rng.uniform(10, 40),
                  size=rng.uniform(12, 22), ang=rng.uniform(-3, 3)) for _ in range(14)]
    puffs = [dict(a=rng.uniform(0, 2 * math.pi), v=rng.uniform(10, 26), up=rng.uniform(6, 22),
                  size=rng.uniform(22, 36), ang=rng.uniform(-3, 3), c=rng.uniform(0.35, 0.55)) for _ in range(12)]
    frames = []
    for f in range(F):
        t = (f + 0.5) / F * T
        u = t / T
        acc = np.zeros((H, W, 4), np.float32)
        # a shock ring along the ground
        if u < 0.6:
            r = (14 + 80 * u) * ss
            _stamp(acc, ring, ax, ay, 2 * r, 0, (1.0, 0.95, 0.85), 'over', 0.55 * (1 - u / 0.6), squash=0.5)
        # dust and smoke
        for p in puffs:
            d = p['v'] * (1 - math.exp(-t * 3)) * ss
            x = ax + math.cos(p['a']) * d
            y = ay + math.sin(p['a']) * d * 0.5 - p['up'] * t * ss
            c = p['c']
            _stamp(acc, smk if p['c'] > 0.45 else dust, x, y, p['size'] * ss * (0.6 + u), p['ang'] + t,
                   (c * 1.1, c, c * 0.9), 'over', min(1.0, (1 - u) * 2.2) * 0.9)
        # fragments
        if u < 0.5:
            _stamp(acc, shr, ax, ay - 14 * ss * u, (30 + 110 * u) * ss, 0.3, (0.55, 0.5, 0.45), 'over',
                   0.9 * (1 - u / 0.5))
        # fireballs
        for p in balls:
            if u > 0.75:
                break
            d = p['v'] * (1 - math.exp(-t * 4)) * ss
            x = ax + math.cos(p['a']) * d
            y = ay + math.sin(p['a']) * d * 0.5 - p['up'] * t * ss - 8 * ss
            _stamp(acc, fl, x, y, p['size'] * ss * (1 - 0.6 * u), p['ang'], (1.0, 0.85 - 0.3 * u, 0.6 - 0.5 * u),
                   'add', (1 - u / 0.75) ** 0.8)
        # flash
        if u < 0.35:
            _stamp(acc, rad, ax, ay - 10 * ss, (40 + 80 * u) * ss, 0, (1, 1, 1), 'add', 1.2 * (1 - u / 0.35))
        frames.append(_finish(acc, ss, ax, ay))
    return {'blast': dict(frames=frames, n=F, dur=T)}


def build_ripple():
    """Rings on the water above a fish: ring.png recolored into light foam, along the ground (squashed 2:1), 16 frames."""
    ss, F = 3, 16
    W, H = 48 * ss, 26 * ss
    ax, ay = W // 2, H // 2
    ring = _ptex('ring.png')
    frames = []
    for f in range(F):
        acc = np.zeros((H, W, 4), np.float32)
        for j in (0, 0.5):
            u = (f / F + j) % 1.0
            r = (3 + 19 * u) * ss
            _stamp(acc, ring, ax, ay, 2 * r, 0, (1.2, 1.6, 4.6), 'over', 0.9 * (1 - u) ** 1.2, squash=0.5)
        frames.append(_finish(acc, ss, ax, ay))
    return {'ripple': dict(frames=frames, n=F, dur=2.6)}


# ================================================================== animal carcasses
ANIMALS = {'sheep': 'fauna/sheep1.xml', 'deer': 'fauna/deer.xml', 'boar': 'fauna/boar.xml'}
MEAT_TINT = (0.72, 0.4, 0.36, 1.0)
BLOOD_TINT = (0.55, 0.3, 0.3)


def _neutral(spr):
    """The carcass is nobody's: the player-color area (the 0 A.D. mask, for a sheep - wool) -> neutral light wool."""
    rgba = spr.rgba.astype(np.float32)
    m = spr.mask.astype(np.float32)[..., None] / 255.0
    lum = rgba[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
    wool = np.clip(lum[..., None] * 1.9, 0, 235) * np.array([1.0, 0.96, 0.88], np.float32)
    rgba[..., :3] = rgba[..., :3] * (1 - m) + wool * m
    return Frame(np.clip(rgba, 0, 255).astype(np.uint8), spr.ox, spr.oy)


def _blood(seed, scale):
    ps = resolve('props/units/blood_01.xml', seed=seed)
    return [p for p in ps if p.is_decal], scale


def build_carcass():
    """A carcass: stage 0 - the last frame of the 0 A.D. death animation (like units), a pool of blood;
    1 - a skinned carcass (the same silhouette, the color of meat, smaller) and a piece of meat; 2 - a skull and scraps.
    8 directions (like units: the angle d*45 deg)."""
    out = {}
    r = R()
    for kind, actor in ANIMALS.items():
        tree = aa.build(actor, 'death')
        dead = aa.evaluate(tree, 0.999)
        # a just-killed animal - a living hide (a sheep in 0 A.D. has a "butchered" death texture - it is for stage 1)
        alive = aa.build(actor, 'idle').textures.get('baseTex')
        fresh = [Part(p.mesh, p.matrix, dict(p.textures, baseTex=alive) if p.mesh == tree.mesh else p.textures,
                      p.material, p.actor, p.decal, p.tags, p.geom) for p in dead]
        own_dead = tree.textures.get('baseTex') != alive
        blood = _dark_blood([p for p in resolve('props/units/blood_01.xml', seed={'sheep': 1, 'deer': 4, 'boar': 7}[kind])
                             if p.is_decal])
        lo, hi = parts_bounds(dead)
        length = max(hi[0] - lo[0], hi[1] - lo[1])
        frames = []
        for stage in range(3):
            for d in range(16):
                yaw = d * 22.5 + FWD
                place = camera.placement(S_ANIMAL, yaw, center=(0.0, 0.0), mirror=MIRROR)
                items = []
                bs = 0.62 if stage == 0 else 0.55 if stage == 1 else 0.45
                bpl = camera.placement(S_ANIMAL * bs * max(1.0, length / 3.0), yaw + 30, center=(0.0, 0.0))
                items += Renderer.build_items(blood, bpl)
                if stage == 0:
                    items += Renderer.build_items(fresh, place)
                elif stage == 1:
                    sc = camera.placement(S_ANIMAL * 0.9, yaw, center=(0.0, 0.0), mirror=MIRROR)
                    items += Renderer.build_items(dead, sc, tint_fn=None if own_dead else lambda p: MEAT_TINT)
                    items += Renderer.build_items(_meat(), camera.placement(S_ANIMAL * 0.9, yaw + 70,
                                                                             center=(0.05, 0.22)))
                else:
                    # the skeleton: along the main axis of the lying carcass (PCA over the vertices of the death pose)
                    pts = np.concatenate([it['pos'] for it in Renderer.build_items(dead, place)
                                          if it['kind'] == 'mesh'])[:, :2]
                    c = pts.mean(0)
                    ev, evec = np.linalg.eigh(np.cov((pts - c).T))
                    ax_ = evec[:, 1]
                    L = 2.0 * np.sqrt(ev[1]) * 1.7                     # the carcass length, cells
                    ang = math.degrees(math.atan2(ax_[1], ax_[0])) - 90.0   # the ribs' Y axis -> along the carcass
                    items += Renderer.build_items(_bones(), camera.placement(L * 0.6 / 1.05, ang,
                                                                              center=tuple(c)),
                                                  tint_fn=lambda p: (0.8, 0.62, 0.55, 1.0))
                    hx, hy = c + ax_ * L * 0.42
                    items += Renderer.build_items(_skull(), camera.placement(S_ANIMAL * 0.9, ang + 60,
                                                                              center=(hx, hy)),
                                                  tint_fn=lambda p: (0.82, 0.74, 0.62, 1.0))
                    mx, my = c - ax_ * L * 0.3 + np.array([ax_[1], -ax_[0]]) * 0.08
                    items += Renderer.build_items(_meat(), camera.placement(S_ANIMAL * 0.6, yaw + 120,
                                                                             center=(mx, my)))
                spr = r.render(items, footprint=(0, 0), shadow_scale=0.85, pad=1, decal_clip=(-2, -2, 2, 2))
                frames.append(_neutral(spr))
        out['carcass_' + kind] = dict(frames=frames, stages=3, dirs=16)
        print(f'  + carcass {kind}: 3×16')
    return out


def _skull():
    return [Part('props/skull.dae', np.eye(4), {'baseTex': 'props/head/skull.png'}, 'x.xml', 'skull')] \
        if assets.exists('meshes', 'props', 'skull.dae') else []


def _meat():
    return [Part('props/shuttle_meat_male_l.dae', np.eye(4), {'baseTex': 'props/shuttle_meat.png'}, 'x.xml', 'meat')]


def _bones():
    """Ribs and a spine (0 A.D. has no skeleton model - thin arcs are built here): a half-sunken ribcage."""
    pos, nrm = [], []
    rng = np.random.default_rng(2)

    def quad(p0, p1, w, n):
        (x0, y0, z0), (x1, y1, z1) = p0, p1
        q = [(x0, y0 - w, z0), (x1, y1 - w, z1), (x1, y1 + w, z1), (x0, y0 - w, z0), (x1, y1 + w, z1),
             (x0, y0 + w, z0)]
        pos.extend(q)
        nrm.extend([n] * 6)

    for i in range(4):
        y = -0.36 + i * 0.24
        tilt = rng.uniform(-0.25, 0.25)
        pts = []
        for j in range(9):
            a = math.pi * j / 8
            pts.append((math.cos(a) * 0.4, y + tilt * math.cos(a) * 0.4, math.sin(a) * 0.22 + 0.03))
        for j in range(8):
            n = np.array([pts[j][0] + pts[j + 1][0], 0, pts[j][2] + pts[j + 1][2]])
            n /= np.linalg.norm(n) or 1
            quad(pts[j], pts[j + 1], 0.028, n)
    quad((0.0, -0.55, 0.33), (0.0, 0.5, 0.31), 0.05, np.array([0, 0, 1.0]))
    pos = np.array(pos, np.float32)
    geom = dict(pos=pos, nrm=np.array(nrm, np.float32), uv0=np.zeros((len(pos), 2), np.float32),
                uv1=np.zeros((len(pos), 2), np.float32), props={})
    return [Part(None, np.eye(4), {}, 'x.xml', 'bones', geom=geom)]


def _dark_blood(parts):
    """Blood is darker and more transparent than in 0 A.D. (there it is on dark ground; ours is light grass)."""
    out = []
    for p in parts:
        base = p.textures.get('baseTex')
        key = '@blood_dark|' + base
        if key not in assets.GENERATED:
            def gen(base=base):
                a = assets.texture(base)
                if a is None:
                    return None
                a = a.astype(np.float32)
                a[..., :3] *= np.array(BLOOD_TINT, np.float32)
                a[..., 3] *= 0.8
                return a.astype(np.uint8)
            assets.GENERATED[key] = gen
        out.append(Part(p.mesh, p.matrix, dict(p.textures, baseTex=key), p.material, p.actor, p.decal, p.tags,
                        p.geom))
    return out


# ================================================================== stumps
TREES = {
    # species (as in build_nature.TREES): the actor, the scale as for the tree
    'oak': 'flora/trees/oak_new.xml', 'beech': 'flora/trees/european_beech.xml',
    'deci': 'flora/trees/temperate_forest_biome_tree.xml', 'birch': 'flora/trees/euro_birch_tree.xml',
    'pine': 'flora/trees/pine.xml', 'fir': 'flora/trees/fir_tree.xml', 'poplar': 'flora/trees/poplar.xml',
}
STUMP_H = 0.13                  # stump height, cells
STUMP_R = 0.1                 # stump radius, cells (a 0 A.D. trunk at the nature scale is thinner - we thicken it slightly)


def _ring_tex():
    """The stump's cut end: growth rings (a procedural texture for the cap; the wood - by the color of the cut)."""
    key = '@stump_rings'
    if key not in assets.GENERATED:
        def gen():
            n = 64
            y, x = np.mgrid[0:n, 0:n].astype(np.float32) - n / 2 + 0.5
            rr = np.hypot(x, y) / (n / 2)
            ring = 0.5 + 0.5 * np.sin(rr * 26 + np.sin(np.arctan2(y, x) * 3) * 0.4)
            base = np.array([184, 156, 118], np.float32)
            dark = np.array([150, 110, 66], np.float32)
            c = base * (1 - 0.35 * ring[..., None]) + dark * 0.35 * ring[..., None]
            c = np.where((rr > 0.86)[..., None], np.array([92, 68, 44], np.float32), c)
            out = np.zeros((n, n, 4), np.uint8)
            out[..., :3] = np.clip(c, 0, 255)
            out[..., 3] = 255
            return out
        assets.GENERATED[key] = gen
    return key


def _trunk_parts(actor, seed=0):
    """The tree parts without foliage (alpha-test/transparent materials) - the trunk."""
    parts = resolve(actor, seed=seed, prefer=frozenset({'alive', 'idle', 'base'}))
    keep = [p for p in parts if not p.is_decal and not p.alpha_test and 'leaf' not in (p.textures.get('baseTex') or '')]
    return keep or parts


def _cap(cx, cy, z, rad, n=18):
    pos, uv = [], []
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        for (px, py) in ((0, 0), (math.cos(a0), math.sin(a0)), (math.cos(a1), math.sin(a1))):
            pos.append((cx + px * rad, cy + py * rad, z))
            uv.append((0.5 + px * 0.5, 0.5 + py * 0.5))
    pos = np.array(pos, np.float32)
    uv = np.array(uv, np.float32)
    uv[:, 1] = 1 - uv[:, 1]         # build_items flips v
    return dict(pos=pos, nrm=np.tile([0, 0, 1.0], (len(pos), 1)).astype(np.float32), uv0=uv, uv1=uv, props={})


def _cyl(cx, cy, z0, z1, rad, n=18, jag=None):
    """The stump's side surface: a cylinder with bark (UV along the circumference)."""
    pos, nrm, uv = [], [], []
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        r0 = rad * (1.0 + (jag[i] if jag is not None else 0))
        r1 = rad * (1.0 + (jag[(i + 1) % n] if jag is not None else 0))
        b0, b1 = r0 * 1.35, r1 * 1.35          # roots: wider at the bottom
        quad = [((cx + math.cos(a0) * b0, cy + math.sin(a0) * b0, z0), (i / n, 1)),
                ((cx + math.cos(a1) * b1, cy + math.sin(a1) * b1, z0), ((i + 1) / n, 1)),
                ((cx + math.cos(a1) * r1, cy + math.sin(a1) * r1, z1), ((i + 1) / n, 0.7)),
                ((cx + math.cos(a0) * r0, cy + math.sin(a0) * r0, z1), (i / n, 0.7))]
        for idx in (0, 1, 2, 0, 2, 3):
            p, t = quad[idx]
            pos.append(p)
            uv.append(t)
            a = a0 if idx in (0, 3) else a1
            nrm.append((math.cos(a), math.sin(a), 0.25))
    return dict(pos=np.array(pos, np.float32), nrm=np.array(nrm, np.float32), uv0=np.array(uv, np.float32),
                uv1=np.array(uv, np.float32), props={})


def _bark(actor):
    """The tree's bark texture (the first opaque part)."""
    for p in _trunk_parts(actor):
        t = p.textures.get('baseTex')
        if t:
            return t
    return None


def build_stumps():
    """Stumps: a cylinder with bark of the same species (the 0 A.D. trunk texture) and a cut end with rings, chips/a log block nearby."""
    out = {}
    r = R()
    frames, names = [], []
    rng = np.random.default_rng(3)
    for sp, actor in TREES.items():
        bark = _bark(actor)
        names.append(sp)
        for v in range(2):
            rad = STUMP_R * (0.85 + 0.3 * v)
            h = STUMP_H * (0.8 + 0.35 * v)
            jag = rng.uniform(-0.08, 0.08, 18)
            side = Part(None, np.eye(4), {'baseTex': bark}, 'x.xml', 'stump', geom=_cyl(0, 0, -0.02, h, rad, jag=jag))
            top = Part(None, np.eye(4), {'baseTex': _ring_tex()}, 'x.xml', 'stump', geom=_cap(0, 0, h, rad * 1.02))
            items = Renderer.build_items([side, top], np.eye(4))
            # chips around (0 A.D. branch stubs - wrld_wood_*, small)
            if assets.exists('meshes', 'props', 'wrld_wood_a.dae'):
                for j in range(2):
                    a = rng.uniform(0, 2 * math.pi)
                    log = Part('props/wrld_wood_a.dae', np.eye(4), {'baseTex': bark}, 'x.xml', 'log')
                    items += Renderer.build_items([log], camera.placement(
                        0.035, rng.uniform(0, 180), center=(math.cos(a) * 0.2, math.sin(a) * 0.2)))
            spr = r.render(items, footprint=(0, 0), shadow_scale=0.8, pad=1)
            frames.append(_spr(spr))
    out['stump'] = dict(frames=frames, species=names, vars=2)
    print(f'  + stumps: {len(names)}×2')
    return out


# ================================================================== rubble
def build_rubble():
    """0 A.D. rubble (structures/destruct_*: a heap of stone/charred logs + a scorched-earth decal)
    for sizes of 1..4 cells; the anchor is the center of the base."""
    out = {}
    r = R()
    src = {
        'stone': {1: 'structures/destruct_stone_wall_tower.xml', 2: 'structures/destruct_stone_2x2.xml',
                  3: 'structures/destruct_stone_3x3.xml', 4: 'structures/destruct_stone_4x4.xml'},
        'wood': {1: 'structures/destruct_wood_3x3.xml', 2: 'structures/destruct_wood_3x3.xml',
                 3: 'structures/destruct_wood_3x3.xml', 4: 'structures/destruct_wood_3x3.xml'},
    }
    for mat, bysize in src.items():
        frames = []
        for size in (1, 2, 3, 4):
            actor = bysize[size]
            if not os.path.exists(assets.art('actors', actor)):
                actor = 'structures/destruct_stone_3x3.xml'
            parts = resolve(actor, skip=lambda a, ap: 'particle' in a)
            lo, hi = parts_bounds(parts)
            ext = max(hi[0] - lo[0], hi[1] - lo[1], 1e-3)
            s = size * (0.92 if size > 1 else 1.1) / ext
            mc = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
            place = camera.placement(s, 15.0 * size, center=(0.0, 0.0), model_center=mc)
            items = Renderer.build_items(parts, place)
            h = size / 2 + 0.12
            spr = r.render(items, footprint=(0, 0), decal_clip=(-h, -h, h, h), shadow_scale=0.9, pad=1)
            frames.append(_spr(spr))
        out['rubble_' + mat] = dict(frames=frames, sizes=[1, 2, 3, 4])
        print(f'  + rubble {mat}: 4 sizes')
    return out


# ================================================================== projectiles
def _view_dir(theta):
    """A unit vector in the screen plane (perpendicular to the look direction), seen at the screen angle theta."""
    A = np.array([[camera.HW, -camera.HW, 0], [camera.HH, camera.HH, -camera.ZK], camera.VIEW])
    d = np.linalg.solve(A, np.array([math.cos(theta), math.sin(theta), 0.0]))
    return d / np.linalg.norm(d)


def _axis_place(u, length_tiles, lo_z, hi_z, spin=0.0, thick=1.0):
    """A matrix: the model's Z axis (from lo_z to hi_z) -> the direction u, length length_tiles cells, the center - at the origin."""
    u = np.asarray(u, np.float64)
    a = np.cross(u, camera.VIEW)
    a /= np.linalg.norm(a)
    b = np.cross(u, a)
    ca, sa = math.cos(spin), math.sin(spin)
    a, b = a * ca + b * sa, -a * sa + b * ca
    s = length_tiles / max(hi_z - lo_z, 1e-6)
    M = np.eye(4)
    M[:3, 0] = a * s * thick
    M[:3, 1] = b * s * thick
    M[:3, 2] = u * s
    M[:3, 3] = -u * s * (lo_z + hi_z) / 2
    return M


def build_projectiles(ndir=16):
    """An arrow, bolt, javelin - ndir screen directions (0 - right, clockwise); a stone and a cannonball - 4 rotation
    frames. The length in pixels - as with the former lines (arrow 11, bolt 9, javelin 15)."""
    out = {}
    r = R()
    px_per_tile = math.hypot(camera.HW, camera.HH)       # approximately: a 64x32 diamond -> ~36 px per cell along the screen
    spec = {
        # the length - in proportion to DE units (villager ~ 21 px): an arrow ~ half the height
        'arrow': ('props/units/weapons/arrow_front.xml', 10, 2.4),
        'bolt': ('props/units/weapons/bolt_tower.xml', 9, 2.0),
        'javelin': ('props/units/weapons/jav_projectile.xml', 12, 2.6),
    }
    for name, (actor, Lpx, thick) in spec.items():
        parts = [p for p in resolve(actor, seed=0) if not p.is_decal]
        lo, hi = parts_bounds(parts, z_min=-1e9)
        frames = []
        for i in range(ndir):
            th = 2 * math.pi * i / ndir
            u = _view_dir(th)
            plen = np.linalg.norm(camera.project(np.array([u]))[0])
            M = _axis_place(u, Lpx / plen, lo[2], hi[2], spin=0.6, thick=thick)
            items = Renderer.build_items(parts, M)
            spr = r.render(items, footprint=(0, 0), ground=False, pad=2, crop=False)
            frames.append(_outline(spr))
        out['proj_' + name] = dict(frames=frames, dirs=ndir)
        print(f'  + projectile {name}: {ndir} directions')
    # stone and cannonball
    parts = resolve('props/units/weapons/rock.xml')
    lo, hi = parts_bounds(parts, z_min=-1e9)
    for name, dpx, tint in (('stone', 8, None), ('ball', 6, (0.34, 0.33, 0.34, 1.0)), ('shot', 4, (0.34, 0.33, 0.34, 1.0))):
        frames = []
        for k in range(4):
            s = dpx / px_per_tile / max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
            mc = ((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2)
            M = camera.placement(s, 90.0 * k + 20, center=(0.0, 0.0), model_center=mc,
                                 z0=-(lo[2] + hi[2]) / 2 * s)
            # tumbling: rotation about the X axis
            a = math.radians(70 * k)
            Rx = np.array([[1, 0, 0, 0], [0, math.cos(a), -math.sin(a), 0], [0, math.sin(a), math.cos(a), 0],
                           [0, 0, 0, 1]])
            items = Renderer.build_items(parts, M @ _center_m(lo, hi) @ Rx @ np.linalg.inv(_center_m(lo, hi)),
                                         tint_fn=(lambda p, t=tint: t) if tint else None)
            spr = r.render(items, footprint=(0, 0), ground=False, pad=1)
            frames.append(_spr(spr))
        out['proj_' + name] = dict(frames=frames, n=4)
    print('  + projectiles: stone, cannonball, bullet')
    return out


def _center_m(lo, hi):
    T = np.eye(4)
    T[:3, 3] = (lo + hi) / 2
    return T


def _outline(spr, col=(40, 30, 20), alpha=0.55):
    """A thin projectile gets lost on the grass: a lighter shaft and a translucent dark 1 px outline."""
    a = spr.rgba.astype(np.float32)
    al = a[..., 3] / 255.0
    al = np.where(al < 0.12, 0, al)            # we do not outline specks from supersampling
    d = al.copy()
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        d = np.maximum(d, np.roll(np.roll(al, dy, 0), dx, 1))
    ring = np.clip(d - al, 0, 1) * alpha
    rgb = np.clip(a[..., :3] * 1.25 + 12, 0, 255)
    out_a = al + ring * (1 - al)
    out_rgb = (rgb * al[..., None] + np.array(col, np.float32) * (ring * (1 - al))[..., None]) / \
        np.maximum(out_a, 1e-3)[..., None]
    rgba = np.concatenate([out_rgb, out_a[..., None] * 255], axis=2).round().astype(np.uint8)
    return _crop(rgba, spr.ox, spr.oy)


# ================================================================== packing, index, sheet
def pack(frames, width=1024):
    x = y = rowh = 0
    pos = []
    maxw = 0
    for f in frames:
        h, w = f.rgba.shape[:2]
        if x + w > width and x > 0:
            y += rowh
            x = rowh = 0
        pos.append((x, y))
        x += w + 1
        rowh = max(rowh, h + 1)
        maxw = max(maxw, x)
    sheet = np.zeros((max(1, y + rowh), max(1, maxw), 4), np.uint8)
    rects = []
    for (px, py), f in zip(pos, frames):
        h, w = f.rgba.shape[:2]
        sheet[py:py + h, px:px + w] = f.rgba
        rects.append([px, py, w, h, f.ax, f.ay])
    return rects, sheet


GROUPS = {
    'fish': build_fish, 'ripple': build_ripple, 'carcass': build_carcass, 'stump': build_stumps,
    'rubble': build_rubble, 'flame': build_flame, 'smoke': build_smoke, 'blast': build_blast,
    'proj': build_projectiles,
}


def save(groups, old):
    os.makedirs(OUT, exist_ok=True)
    index = dict(old)
    for name, g in groups.items():
        rects, sheet = pack(g.pop('frames'))
        path = os.path.join(OUT, name + '.png')
        Image.fromarray(sheet).save(path, optimize=True)
        g['file'] = 'decals/' + name + '.png'
        g['frames'] = rects
        index[name] = g
        print(f'    {name:18s} {len(rects):4d} frames  {sheet.shape[1]}×{sheet.shape[0]}  '
              f'{os.path.getsize(path) / 1024:5.0f} KB')
    doc = {'version': 1, 'license': 'CC BY-SA 3.0, derived from 0 A.D. (c) Wildfire Games; see CREDITS.md',
           'groups': index}
    with open(INDEX, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    return index


def contact_sheet(index, png):
    from PIL import ImageDraw
    tiles = []
    for name, g in index.items():
        sheet = Image.open(os.path.join(GEN, g['file'])).convert('RGBA')
        for i, (x, y, w, h, ax, ay) in enumerate(g['frames']):
            if name.startswith('proj_') and i % 2:
                continue
            im = sheet.crop((x, y, x + w, y + h))
            bg_col = (60, 120, 170, 255) if name.startswith(('fish', 'ripple')) else (98, 140, 62, 255)
            W, H = max(w, 40) + 10, h + 22
            bg = Image.new('RGBA', (W, H), bg_col)
            bg.alpha_composite(im, (5, 17))
            dr = ImageDraw.Draw(bg)
            dr.line([(5 + ax - 2, 17 + ay), (5 + ax + 2, 17 + ay)], fill=(255, 255, 0))
            dr.text((2, 2), f'{name[:9]}{i}', fill=(255, 255, 255))
            tiles.append(bg)
    rows, row, xw = [], [], 0
    for t in tiles:
        if xw + t.size[0] > 1600 and row:
            rows.append(row)
            row, xw = [], 0
        row.append(t)
        xw += t.size[0]
    rows.append(row)
    W = max(sum(t.size[0] for t in rw) for rw in rows)
    H = sum(max(t.size[1] for t in rw) for rw in rows)
    out = Image.new('RGBA', (W, H), (30, 30, 30, 255))
    y = 0
    for rw in rows:
        x = 0
        for t in rw:
            out.paste(t, (x, y))
            x += t.size[0]
        y += max(t.size[1] for t in rw)
    os.makedirs(os.path.dirname(os.path.abspath(png)), exist_ok=True)
    out.save(png)
    print('sheet', png)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--only', default='', help='groups separated by commas: ' + ','.join(GROUPS))
    ap.add_argument('--sheet', default='', help='a PNG contact sheet')
    a = ap.parse_args()
    only = [x for x in a.only.split(',') if x] or list(GROUPS)
    old = {}
    if os.path.exists(INDEX):
        with open(INDEX, encoding='utf-8') as f:
            old = json.load(f).get('groups', {})
    t0 = time.time()
    res = {}
    for g in only:
        print('==', g)
        res.update(GROUPS[g]())
    index = save(res, old)
    print(f'done in {time.time() - t0:.0f} s')
    if a.sheet:
        contact_sheet(index, a.sheet)


if __name__ == '__main__':
    main()
