"""Recoloring the clothing of human bodies when building sprites (docs/research/06_units_recognition.md, R1/R2).

All 0 A.D. / Millennium A.D. humans have bodies - skeletal/new/* meshes with one skeleton. Their clothing textures are
"patchwork" (the same pieces of UV cover the chest, back and sides), so a pattern cannot be drawn by UV. Instead
the body is split into two parts:
  * the original - head/neck/hands/feet and everything the style does not touch, with the original texture after R2;
  * the clothing - the triangles of the torso, hem, arms, legs (by the skin weights: the bone with the highest weight) with a new
    unwrap: u - the angle around the body's axis (0.5 - the middle of the chest, 0/1 - the middle of the back), v - the height in the
    bind pose, in bands: [0, .5) - the torso and hem (z 1.0...3.9), [.5, .75) - arms, [.75, 1) - legs.
    The texture is the style's pattern (the player color - alpha 0, as in 0 A.D.), AO and normals - from the original mesh.

  style        torso and hem                          arms            legs
  'tabard'     player color, a white stripe front/back  linen         neutral
  'surcoat'    player color, a white trim               as it was     neutral
  'white'      white, a cross in player color           linen         neutral
  'quarter'    a 2x2 checkerboard (player color / white) linen        neutral
  'bands'      horizontal stripes                       player color  striped
  'apron'      a linen shirt, an apron in player color  linen         player color
  'dress'      a light dress, an apron in player color  linen         (a dress)
  'stole'      a light robe, a stole in player color    robe          (a robe)
  'bare'       a bare torso                             skin          player color
  'vest'       a leather vest                           player color  player color
  'gambeson'   a white gambeson                         player color  player color
  'robe'       a white robe, a sash in player color     white         white (a janissary)
  'plain'      only R2
In all styles R2: the saturated red and teal cloth of the original texture outside the player mask -> linen.
"""
import math

import numpy as np

from . import assets, skin

LINEN = (226, 220, 204)
PLAYER = (205, 205, 210)          # a backing under the player color (the recoloring takes the brightness)
SKIN = (212, 164, 128)
PANTS = (110, 94, 76)
ROBE = (206, 194, 166)
LEATHER = (124, 86, 54)
WHITE = (236, 234, 228)

REG = {'spine': 'torso', 'spine1': 'torso', 'chest': 'torso', 'neck': 'neck', 'hip': 'hip',
       'shoulder_L': 'shoulder', 'shoulder_R': 'shoulder', 'arm_L': 'arm', 'arm_R': 'arm',
       'forearm_L': 'arm', 'forearm_R': 'arm', 'hand_L': 'hand', 'hand_R': 'hand',
       'thigh_L': 'thigh', 'thigh_R': 'thigh', 'knee_L': 'leg', 'knee_R': 'leg', 'leg_L': 'leg', 'leg_R': 'leg',
       'foot_L': 'foot', 'foot_R': 'foot'}
KNEE = 1.35                       # below - legs (trousers), above - the hem

# style -> (the torso pattern, arms, legs); arms/legs: a color | 'player' | None (the original texture) | 'bands'
STYLES = {
    'tabard': ('tabard', LINEN, PANTS),
    'surcoat': ('surcoat', None, PANTS),
    'white': ('white', LINEN, PANTS),
    'quarter': ('quarter', LINEN, PANTS),
    'bands': ('bands', 'player', 'bands'),
    'apron': ('apron', LINEN, 'player'),
    'dress': ('dress', LINEN, 'dress'),
    'stole': ('stole', ROBE, ROBE),
    'bare': ('bare', SKIN, 'player'),
    'vest': ('vest', 'player', 'player'),
    'gambeson': ('gambeson', 'player', 'player'),
    'robe': ('robe', WHITE, WHITE),
    'plain': (None, None, None),
}
TW, TH = 128, 256                 # the pattern texture
V_TORSO, V_ARM, V_LEG = (0.0, 0.5), (0.5, 0.75), (0.75, 1.0)
Z_TORSO, Z_ARM, Z_LEG = (1.0, 3.9), (2.0, 3.7), (0.0, 1.6)


def applies(mesh, material):
    return bool(mesh) and mesh.startswith('skeletal/new/') and 'player' in (material or '')


# ------------------------------------------------------------------ triangle classes
_CLS = {}


def classes(mesh):
    """For a mesh: (the triangle class (T,) - 0 other, 1 torso/hem, 2 arms, 3 legs; u, v of the original pose (N,)
    per triangle vertices, in shares of its own band)."""
    if mesh in _CLS:
        return _CLS[mesh]
    sm = skin.skinned(mesh)
    if sm is None:
        _CLS[mesh] = None
        return None
    names = sm['joints']
    dom = sm['jidx'][np.arange(len(sm['jw'])), sm['jw'].argmax(1)]
    reg = np.array([REG.get(names[j], '') for j in dom])
    P = sm['pos'].astype(np.float64)
    zmax = float(P[:, 2].max()) or 1.0
    P = P / zmax * 3.85
    T = len(P) // 3
    cls = np.zeros(T, np.int8)
    for t in range(T):
        r = list(reg[3 * t:3 * t + 3])
        top = max(set(r), key=r.count)
        zc = P[3 * t:3 * t + 3, 2].mean()
        if top in ('torso', 'neck', 'shoulder', 'hip') or (top == 'thigh' and zc > KNEE):
            cls[t] = 1
        elif top == 'arm':
            cls[t] = 2
        elif top == 'leg' or (top == 'thigh' and zc <= KNEE):
            cls[t] = 3
    # the angle around the body's axis: 0.5 - front (-Y), 0/1 - back
    th = np.arctan2(P[:, 0], -P[:, 1]) / (2 * math.pi) + 0.5
    u = th.copy()
    # a triangle across the seam on the back: pull small u up to large ones (the texture repeats along u)
    uu = u.reshape(-1, 3)
    wrap = (uu.max(1) - uu.min(1)) > 0.5
    uu[wrap] = np.where(uu[wrap] < 0.5, uu[wrap] + 1.0, uu[wrap])
    u = uu.reshape(-1)
    z = P[:, 2]
    _CLS[mesh] = (cls, u.astype(np.float32), z.astype(np.float32))
    return _CLS[mesh]


def _band(z, zr, vr):
    f = np.clip((z - zr[0]) / (zr[1] - zr[0]), 0.0, 1.0)
    # v grows downward along the texture: the top of the body - the smaller v
    return vr[0] + (1.0 - f) * (vr[1] - vr[0]) * 0.999 + 0.0005


def split(mesh, style, geom):
    """The body geometry in a pose -> [(geom, role)]: the role 'orig' (the original texture) or 'cloth' (the style pattern)."""
    st = STYLES.get(style)
    c = classes(mesh)
    if st is None or c is None or st[0] is None:
        return [(geom, 'orig')]
    cls, u, z = c
    torso, arms, legs = st
    use = np.zeros(len(cls), bool)
    use |= cls == 1
    if arms is not None:
        use |= cls == 2
    if legs is not None:
        use |= cls == 3
    out = []
    keep = ~use
    tv = np.repeat(np.arange(len(cls)), 3)
    if keep.any():
        k = keep[tv]
        out.append(({kk: (vv[k] if kk != 'props' else vv) for kk, vv in geom.items()}, 'orig'))
    k = use[tv]
    vc = cls[tv][k]
    zz = z[k]
    v = np.where(vc == 1, _band(zz, Z_TORSO, V_TORSO), np.where(vc == 2, _band(zz, Z_ARM, V_ARM),
                                                                 _band(zz, Z_LEG, V_LEG)))
    uv = np.stack([u[k], 1.0 - v], 1).astype(np.float32)     # as in COLLADA: v from bottom to top
    g = {kk: (vv[k] if kk != 'props' else vv) for kk, vv in geom.items()}
    g['uv0'] = uv
    out.append((g, 'cloth'))
    return out


# ------------------------------------------------------------------ textures
def orig_key(tex):
    """R2 for the body's original texture."""
    k = f'@r2|{tex}'
    if k not in assets.GENERATED:
        def gen(tex=tex):
            a = assets.texture(tex)
            if a is None:
                return None
            a = a.copy()
            rgb = neutralize(a[..., :3].astype(np.float32), a[..., 3] < 128)
            a[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
            return a
        assets.GENERATED[k] = gen
    return k


def cloth_key(style):
    k = f'@cloth|{style}'
    if k not in assets.GENERATED:
        assets.GENERATED[k] = lambda: pattern(style)
    return k


def _hsv(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dd = np.maximum(d, 1e-6)
    h = np.zeros_like(mx)
    h = np.where(mx == r, ((g - b) / dd) % 6, h)
    h = np.where(mx == g, (b - r) / dd + 2, h)
    h = np.where(mx == b, (r - g) / dd + 4, h)
    return h * 60.0, s, mx


def neutralize(rgb, keep):
    """R2: saturated red (+-15 deg from 0) and teal (160-205 deg) outside keep -> linen/grey with folds."""
    h, s, v = _hsv(rgb / 255.0)
    red = ((h < 14) | (h > 335)) & (s > 0.42) & (v > 0.18)
    teal = (h > 160) & (h < 205) & (s > 0.25)
    m = (red | teal) & ~keep
    if not m.any():
        return rgb
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    out = rgb.copy()
    lin = np.array(LINEN, np.float32) / max(LINEN)
    tgt = np.clip(lum[..., None] * 1.35 + 30, 0, 255) * lin
    out[m] = tgt[m]
    return out


def pattern(style):
    """The style pattern's texture (TH x TW RGBA): u - the angle (0.5 - front), v - the torso/arms/legs bands."""
    torso, arms, legs = STYLES[style]
    img = np.zeros((TH, TW, 4), np.float32)
    img[..., 3] = 255
    uu = (np.arange(TW) + 0.5) / TW
    vv = (np.arange(TH) + 0.5) / TH
    U, V = np.meshgrid(uu, vv)
    ang = (U - 0.5) * 2 * math.pi                      # 0 - front, +-pi - back
    fr = np.cos(ang)                                   # 1 - front, -1 - back
    side = np.abs(np.sin(ang))
    player = np.zeros((TH, TW), bool)

    def zof(vr, zr):
        f = 1.0 - (V - vr[0]) / (vr[1] - vr[0])
        return zr[0] + f * (zr[1] - zr[0])

    def fill(m, col, is_player=False):
        img[m, :3] = col
        player[m] = is_player
        if not is_player:
            img[m, 3] = 255

    bT = V < V_TORSO[1]
    bA = (V >= V_ARM[0]) & (V < V_ARM[1])
    bL = V >= V_LEG[0]
    z = np.where(bT, zof(V_TORSO, Z_TORSO), np.where(bA, zof(V_ARM, Z_ARM), zof(V_LEG, Z_LEG)))
    stripe = side < 0.2                                 # a vertical stripe along the middle of the chest and back
    if torso == 'tabard':
        fill(bT, PLAYER, True)
        fill(bT & stripe, LINEN)
        fill(bT & (z < 1.55), LINEN)                    # a white hem
    elif torso == 'surcoat':
        fill(bT, PLAYER, True)
        fill(bT & (z > 2.3) & (z < 2.45), LINEN)        # a white belt
        fill(bT & (z < 1.5), LINEN)
    elif torso == 'white':
        fill(bT, LINEN)
        fill(bT & ((stripe & (z > 1.9)) | ((z > 2.85) & (z < 3.15))), PLAYER, True)
    elif torso == 'quarter':
        q = (np.sin(ang) > 0) ^ (z > 2.45)
        fill(bT & q, PLAYER, True)
        fill(bT & ~q, LINEN)
    elif torso == 'bands':
        b = (np.floor(z / 0.36).astype(np.int32) % 2) == 0
        fill(bT & b, PLAYER, True)
        fill(bT & ~b, LINEN)
    elif torso == 'apron':
        fill(bT, LINEN)
        fill(bT & (fr > 0.35) & (z < 2.4), PLAYER, True)
        fill(bT & (z > 2.3) & (z < 2.42), LEATHER)       # belt
    elif torso == 'dress':
        fill(bT, LINEN)
        fill(bT & (fr > 0.3) & (z < 2.45), PLAYER, True)
        fill(bT & (z > 2.95) & (z < 3.3), PLAYER, True)  # bodice
    elif torso == 'stole':
        fill(bT, ROBE)
        fill(bT & stripe & (z > 1.1), PLAYER, True)
        fill(bT & (z > 3.25), PLAYER, True)             # shoulder piece
    elif torso == 'bare':
        fill(bT, SKIN)
        fill(bT & (z < 2.35), PLAYER, True)             # kilt/trousers
        fill(bT & (z >= 2.25) & (z < 2.4), LEATHER)
    elif torso == 'vest':
        fill(bT, LEATHER)
        fill(bT & (z < 1.8), PLAYER, True)
    elif torso == 'gambeson':
        fill(bT, WHITE)
        fill(bT & (z > 2.3) & (z < 2.42), LEATHER)
    elif torso == 'robe':
        fill(bT, WHITE)
        fill(bT & (z > 2.2) & (z < 2.5), PLAYER, True)  # sash
    for band, spec, zr in ((bA, arms, Z_ARM), (bL, legs, Z_LEG)):
        if spec is None:
            continue
        if spec == 'player':
            fill(band, PLAYER, True)
        elif spec == 'bands':
            b = (np.floor(z / 0.3).astype(np.int32) % 2) == 0
            fill(band & b, PLAYER, True)
            fill(band & ~b, LINEN)
        elif spec == 'dress':
            fill(band, LINEN)
            fill(band & (fr > 0.3), PLAYER, True)
        else:
            fill(band, spec)
    # cloth folds: vertical stripes and noise - so it is not "plastic"
    rs = np.random.RandomState(11)
    folds = 1.0 + 0.07 * np.sin(U * 2 * math.pi * 9 + rs.rand() * 6) + (rs.rand(TH, TW) - 0.5) * 0.06
    img[..., :3] *= folds[..., None]
    img[..., 3] = np.where(player, 0, 255)
    return np.clip(img, 0, 255).astype(np.uint8)
