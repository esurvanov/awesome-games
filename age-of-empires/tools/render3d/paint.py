"""Перекраска одежды тел людей при сборке спрайтов (docs/research/06_units_recognition.md, R1/R2).

У всех людей 0 A.D. / Millennium A.D. тела — меши skeletal/new/* с одним скелетом. Текстуры одежды у них
«лоскутные» (одни и те же куски UV покрывают грудь, спину и бока), поэтому узор по UV не нарисовать. Вместо этого
тело делится на две детали:
  • исходная — голова/шея/кисти/стопы и всё, что стиль не трогает, с исходной текстурой после R2;
  • одежда — треугольники торса, подола, рук, ног (по весам скина: кость с наибольшим весом) с новой
    развёрткой: u — угол вокруг оси тела (0.5 — середина груди, 0/1 — середина спины), v — высота в позе
    привязки, по полосам: [0, .5) — торс и подол (z 1.0…3.9), [.5, .75) — руки, [.75, 1) — ноги.
    Текстура — узор стиля (цвет игрока — альфа 0, как у 0 A.D.), AO и нормали — от исходного меша.

  стиль        торс и подол                          руки            ноги
  'tabard'     цвет игрока, белая полоса спереди/сзади  лён           нейтральные
  'surcoat'    цвет игрока, белая кайма                 как было      нейтральные
  'white'      белый, крест цвета игрока                лён           нейтральные
  'quarter'    шахматка 2×2 (цвет игрока / белый)       лён           нейтральные
  'bands'      горизонтальные полосы                    цвет игрока   полосатые
  'apron'      льняная рубаха, фартук цвета игрока      лён           цвет игрока
  'dress'      светлое платье, фартук цвета игрока      лён           (платье)
  'stole'      светлая ряса, стола цвета игрока         ряса          (ряса)
  'bare'       голый торс                               кожа          цвет игрока
  'vest'       кожаный жилет                            цвет игрока   цвет игрока
  'gambeson'   белая стёганка                           цвет игрока   цвет игрока
  'robe'       белый халат, кушак цвета игрока          белый         белый (янычар)
  'plain'      только R2
Во всех стилях R2: насыщенная красная и бирюзовая ткань исходной текстуры вне маски игрока → лён.
"""
import math

import numpy as np

from . import assets, skin

LINEN = (226, 220, 204)
PLAYER = (205, 205, 210)          # подложка под цвет игрока (перекраска берёт яркость)
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
KNEE = 1.35                       # ниже — ноги (штаны), выше — подол

# стиль → (узор торса, руки, ноги); руки/ноги: цвет | 'player' | None (исходная текстура) | 'bands'
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
TW, TH = 128, 256                 # текстура узора
V_TORSO, V_ARM, V_LEG = (0.0, 0.5), (0.5, 0.75), (0.75, 1.0)
Z_TORSO, Z_ARM, Z_LEG = (1.0, 3.9), (2.0, 3.7), (0.0, 1.6)


def applies(mesh, material):
    return bool(mesh) and mesh.startswith('skeletal/new/') and 'player' in (material or '')


# ------------------------------------------------------------------ классы треугольников
_CLS = {}


def classes(mesh):
    """Для меша: (класс треугольника (T,) — 0 прочее, 1 торс/подол, 2 руки, 3 ноги; u, v исходной позы (N,)
    по вершинам треугольников, в долях своей полосы)."""
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
    # угол вокруг оси тела: 0.5 — перед (−Y), 0/1 — спина
    th = np.arctan2(P[:, 0], -P[:, 1]) / (2 * math.pi) + 0.5
    u = th.copy()
    # треугольник через шов на спине: подтянуть малые u к большим (текстура повторяется по u)
    uu = u.reshape(-1, 3)
    wrap = (uu.max(1) - uu.min(1)) > 0.5
    uu[wrap] = np.where(uu[wrap] < 0.5, uu[wrap] + 1.0, uu[wrap])
    u = uu.reshape(-1)
    z = P[:, 2]
    _CLS[mesh] = (cls, u.astype(np.float32), z.astype(np.float32))
    return _CLS[mesh]


def _band(z, zr, vr):
    f = np.clip((z - zr[0]) / (zr[1] - zr[0]), 0.0, 1.0)
    # v растёт вниз по текстуре: верх тела — меньшее v
    return vr[0] + (1.0 - f) * (vr[1] - vr[0]) * 0.999 + 0.0005


def split(mesh, style, geom):
    """Геометрия тела в позе → [(geom, роль)]: роль 'orig' (исходная текстура) или 'cloth' (узор стиля)."""
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
    uv = np.stack([u[k], 1.0 - v], 1).astype(np.float32)     # как у COLLADA: v снизу вверх
    g = {kk: (vv[k] if kk != 'props' else vv) for kk, vv in geom.items()}
    g['uv0'] = uv
    out.append((g, 'cloth'))
    return out


# ------------------------------------------------------------------ текстуры
def orig_key(tex):
    """R2 для исходной текстуры тела."""
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
    """R2: насыщенный красный (±15° от 0) и бирюза (160–205°) вне keep → лён/серый со складками."""
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
    """Текстура узора стиля (TH×TW RGBA): u — угол (0.5 — перед), v — полосы торс/руки/ноги."""
    torso, arms, legs = STYLES[style]
    img = np.zeros((TH, TW, 4), np.float32)
    img[..., 3] = 255
    uu = (np.arange(TW) + 0.5) / TW
    vv = (np.arange(TH) + 0.5) / TH
    U, V = np.meshgrid(uu, vv)
    ang = (U - 0.5) * 2 * math.pi                      # 0 — перед, ±π — спина
    fr = np.cos(ang)                                   # 1 — перед, −1 — спина
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
    stripe = side < 0.2                                 # вертикальная полоса по середине груди и спины
    if torso == 'tabard':
        fill(bT, PLAYER, True)
        fill(bT & stripe, LINEN)
        fill(bT & (z < 1.55), LINEN)                    # белый подол
    elif torso == 'surcoat':
        fill(bT, PLAYER, True)
        fill(bT & (z > 2.3) & (z < 2.45), LINEN)        # белый пояс
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
        fill(bT & (z > 2.3) & (z < 2.42), LEATHER)       # пояс
    elif torso == 'dress':
        fill(bT, LINEN)
        fill(bT & (fr > 0.3) & (z < 2.45), PLAYER, True)
        fill(bT & (z > 2.95) & (z < 3.3), PLAYER, True)  # корсаж
    elif torso == 'stole':
        fill(bT, ROBE)
        fill(bT & stripe & (z > 1.1), PLAYER, True)
        fill(bT & (z > 3.25), PLAYER, True)             # оплечье
    elif torso == 'bare':
        fill(bT, SKIN)
        fill(bT & (z < 2.35), PLAYER, True)             # килт/штаны
        fill(bT & (z >= 2.25) & (z < 2.4), LEATHER)
    elif torso == 'vest':
        fill(bT, LEATHER)
        fill(bT & (z < 1.8), PLAYER, True)
    elif torso == 'gambeson':
        fill(bT, WHITE)
        fill(bT & (z > 2.3) & (z < 2.42), LEATHER)
    elif torso == 'robe':
        fill(bT, WHITE)
        fill(bT & (z > 2.2) & (z < 2.5), PLAYER, True)  # кушак
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
    # складки ткани: вертикальные полосы и шум — чтобы не было «пластика»
    rs = np.random.RandomState(11)
    folds = 1.0 + 0.07 * np.sin(U * 2 * math.pi * 9 + rs.rand() * 6) + (rs.rand(TH, TW) - 0.5) * 0.06
    img[..., :3] *= folds[..., None]
    img[..., 3] = np.where(player, 0, 255)
    return np.clip(img, 0, 255).astype(np.uint8)
