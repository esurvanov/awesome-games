"""Процедурные пропы (огнестрел, пушка), которых нет среди моделей 0 A.D. / Millennium A.D.

Меши собираются из примитивов (цилиндры, коробки) в координатах точки крепления пропа, как у оружия 0 A.D.:
ось −Y — «вперёд» (к дулу), +Z — вверх, начало координат — место хвата. Текстуры — фрагменты атласа
оружия 0 A.D. (`props/prop_weap.dds`: дерево и сталь), вырезанные в assets.GENERATED; производная работа
по CC BY-SA 3.0 (см. CREDITS.md).

Актор-проп задаётся строкой '@имя' вместо пути XML (см. animactor.build):
  '@musket'      — аркебуза/мушкет: деревянное ложе + стальной ствол, замок
  '@handcannon'  — ручная пушка: короткий толстый ствол на древке
  '@powderhorn'  — пороховница на поясе
  '@halberd'     — алебарда (древко вдоль +Z, как у копий 0 A.D.)
  '@bombard'     — бомбарда на двухколёсном лафете (корень осадной машины; колёса крутятся в 'walk',
                   ствол откатывается в 'attack_ranged')
  '@ship_cannons'— ряд пушечных стволов по бортам (проп корабля)
Геометрия может зависеть от доли цикла анимации: geom(mesh, anim, frac).
"""
import math

import numpy as np

from . import assets

# ------------------------------------------------------------------ текстуры
_WEAP = 'props/prop_weap.dds'


def _crop(x0, y0, x1, y1, gray=False, tint=None):
    def gen():
        a = assets.texture(_WEAP)
        if a is None:
            c = np.zeros((16, 16, 4), np.uint8)
            c[..., :3] = (120, 90, 60) if not gray else (150, 150, 155)
            c[..., 3] = 255
            return c
        c = a[y0:y1, x0:x1].astype(np.float32)
        if gray:
            lum = c[..., :3] @ np.array([0.299, 0.587, 0.114], np.float32)
            c[..., :3] = lum[..., None] * np.array([0.97, 1.0, 1.05], np.float32)
        if tint is not None:
            c[..., :3] *= np.array(tint, np.float32)[None, None]
        c[..., 3] = 255
        # до степени двойки: мип-карты без полос
        from PIL import Image
        im = Image.fromarray(np.clip(c, 0, 255).astype(np.uint8), 'RGBA').resize((32, 64), Image.BILINEAR)
        return np.asarray(im).copy()
    return gen


TEX = {
    '@tex/wood': _crop(225, 0, 250, 32),
    '@tex/wood_light': _crop(225, 0, 250, 32, tint=(1.25, 1.15, 1.0)),
    '@tex/steel': _crop(30, 190, 50, 225, gray=True, tint=(0.85, 0.87, 0.9)),
    '@tex/iron': _crop(30, 190, 50, 225, gray=True, tint=(0.42, 0.42, 0.44)),
    '@tex/bronze': _crop(30, 190, 50, 225, gray=True, tint=(1.0, 0.72, 0.38)),
    '@tex/horn': _crop(225, 0, 250, 32, gray=True, tint=(1.35, 1.2, 0.95)),
    '@tex/white': _crop(30, 190, 50, 225, gray=True, tint=(1.45, 1.43, 1.38)),
}
def _flat(rgb, alpha=255):
    def gen():
        c = np.zeros((32, 32, 4), np.uint8)
        c[..., :3] = rgb
        # лёгкий шум ткани, чтобы не было «пластика»
        n = (np.random.RandomState(7).rand(32, 32) - 0.5) * 18
        c[..., :3] = np.clip(np.array(rgb, np.float32)[None, None] + n[..., None], 0, 255).astype(np.uint8)
        c[..., 3] = alpha
        return c
    return gen


TEX.update({
    '@tex/player': _flat((205, 205, 210), 0),        # цвет игрока (перекраска по яркости)
    '@tex/linen': _flat((228, 222, 206)),
    '@tex/dark': _flat((28, 26, 24)),
    '@tex/gold': _crop(30, 190, 50, 225, gray=True, tint=(1.45, 1.15, 0.5)),
    '@tex/leather': _flat((112, 78, 50)),
    '@tex/skin': _flat((205, 160, 125)),
    '@tex/red': _flat((170, 40, 30)),
})
def _kite(pattern):
    """Каплевидный щит (меш shield_kite_small, текстура kite_chiro_white Millennium A.D.) с гербом «цвет игрока +
    белый» как у DE: 'bands' — вертикальные полосы, 'diag' — косые, 'chevron' — белый шеврон на цвете игрока."""
    def gen():
        a = assets.texture('props/shields/byza/kite/kite_chiro_white.png')
        if a is None:
            return None
        a = a.copy()
        H, W = a.shape[:2]
        rgb = a[..., :3].astype(np.float32)
        lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
        mx, mn = rgb.max(-1), rgb.min(-1)
        sat = (mx - mn) / np.maximum(mx, 1)
        yy, xx = np.mgrid[0:H, 0:W]
        u, v = xx / W, yy / H
        face = (u < 0.5) & ((a[..., 3] < 128) | ((lum > 140) & (sat < 0.25)) | ((sat > 0.45) & (lum > 90)))
        face &= (v > 0.05) & (v < 0.88)
        boss = (u - 0.29) ** 2 + (v - 0.33) ** 2 < 0.065 ** 2
        face &= ~boss
        fu = (u - 0.14) / 0.3                       # 0…1 по ширине лица щита
        fv = (v - 0.05) / 0.83
        if pattern == 'bands':
            white = (np.floor(fu * 5).astype(np.int32) % 2) == 1
        elif pattern == 'diag':
            white = (np.floor((fu + fv) * 4).astype(np.int32) % 2) == 1
        else:                                       # шеврон
            d = fv - 0.45 + np.abs(fu - 0.5) * 0.9
            white = (d > 0) & (d < 0.2)
        a[face & white, :3] = (238, 236, 230)
        a[face & white, 3] = 255
        a[face & ~white, :3] = (205, 205, 210)
        a[face & ~white, 3] = 0
        return a
    return gen


TEX.update({'@shield/kite_bands': _kite('bands'), '@shield/kite_diag': _kite('diag'),
            '@shield/kite_chevron': _kite('chevron')})
for _k, _f in TEX.items():
    assets.GENERATED.setdefault(_k, _f)


# ------------------------------------------------------------------ примитивы
def _rot_to(axis):
    """Матрица 3×3, переводящая +Z в направление axis."""
    a = np.asarray(axis, np.float64)
    a = a / np.linalg.norm(a)
    z = np.array([0.0, 0.0, 1.0])
    v = np.cross(z, a)
    c = float(z @ a)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))


class Mesh:
    """Накопитель треугольников: pos/nrm/uv по вершинам треугольников подряд (как assets.mesh)."""

    def __init__(self):
        self.P, self.N, self.U = [], [], []

    def tri(self, a, b, c, na, nb, nc, ua, ub, uc):
        self.P += [a, b, c]
        self.N += [na, nb, nc]
        self.U += [ua, ub, uc]

    def quad(self, a, b, c, d, n, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
        self.tri(a, b, c, n, n, n, uv[0], uv[1], uv[2])
        self.tri(a, c, d, n, n, n, uv[0], uv[2], uv[3])

    def cylinder(self, p0, p1, r0, r1=None, seg=10, caps=True, urep=1.0, vrep=1.0):
        """Усечённый конус от p0 (радиус r0) до p1 (r1)."""
        r1 = r0 if r1 is None else r1
        p0 = np.asarray(p0, np.float64)
        p1 = np.asarray(p1, np.float64)
        ax = p1 - p0
        L = np.linalg.norm(ax)
        R = _rot_to(ax)
        slope = (r0 - r1) / max(L, 1e-9)
        for i in range(seg):
            a0 = 2 * math.pi * i / seg
            a1 = 2 * math.pi * (i + 1) / seg
            d0 = R @ np.array([math.cos(a0), math.sin(a0), 0.0])
            d1 = R @ np.array([math.cos(a1), math.sin(a1), 0.0])
            n0 = d0 + slope * ax / L
            n1 = d1 + slope * ax / L
            n0 /= np.linalg.norm(n0)
            n1 /= np.linalg.norm(n1)
            u0, u1 = i / seg * urep, (i + 1) / seg * urep
            a, b = p0 + d0 * r0, p0 + d1 * r0
            c, d = p1 + d1 * r1, p1 + d0 * r1
            self.tri(a, b, c, n0, n1, n1, (u0, 0), (u1, 0), (u1, vrep))
            self.tri(a, c, d, n0, n1, n0, (u0, 0), (u1, vrep), (u0, vrep))
            if caps:
                e = ax / L
                self.tri(p0, b, a, -e, -e, -e, (0.5, 0.5), (u1, 0), (u0, 0))
                self.tri(p1, d, c, e, e, e, (0.5, 0.5), (u0, 1), (u1, 1))

    def box(self, lo, hi, M=None, rep=(1, 1)):
        lo = np.asarray(lo, np.float64)
        hi = np.asarray(hi, np.float64)
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        v = [np.array(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                                   (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1))]
        if M is not None:
            v = [M[:3, :3] @ p + M[:3, 3] for p in v]
        faces = [((0, 3, 2, 1), (0, 0, -1)), ((4, 5, 6, 7), (0, 0, 1)), ((0, 1, 5, 4), (0, -1, 0)),
                 ((2, 3, 7, 6), (0, 1, 0)), ((1, 2, 6, 5), (1, 0, 0)), ((3, 0, 4, 7), (-1, 0, 0))]
        ru, rv = rep
        for idx, n in faces:
            n = np.array(n, np.float64)
            if M is not None:
                n = M[:3, :3] @ n
            self.quad(*[v[i] for i in idx], n, uv=((0, 0), (ru, 0), (ru, rv), (0, rv)))

    def done(self, M=None):
        pos = np.array(self.P, np.float64).reshape(-1, 3)
        nrm = np.array(self.N, np.float64).reshape(-1, 3)
        if M is not None:
            pos = pos @ M[:3, :3].T + M[:3, 3]
            nrm = nrm @ M[:3, :3].T
        uv = np.array(self.U, np.float32).reshape(-1, 2)
        return dict(pos=pos.astype(np.float32), nrm=nrm.astype(np.float32), uv0=uv, uv1=uv.copy(), props={})


def _merge(*ms):
    ms = [m for m in ms if m is not None]
    return dict(pos=np.concatenate([m['pos'] for m in ms]), nrm=np.concatenate([m['nrm'] for m in ms]),
                uv0=np.concatenate([m['uv0'] for m in ms]), uv1=np.concatenate([m['uv1'] for m in ms]),
                props={k: v for m in ms for k, v in m['props'].items()})


# ------------------------------------------------------------------ ручное оружие
# Размеры — в единицах 0 A.D. (человек ≈ 4.2): слегка преувеличены, чтобы ствол читался в спрайте 44 px.
def _musket_wood():
    m = Mesh()
    # приклад: утолщается к плечу (+Y), шейка, цевьё под стволом до −1.6
    m.cylinder((0, 0.75, -0.06), (0, 0.15, 0.0), 0.12, 0.075, seg=8)
    m.cylinder((0, 0.15, 0.0), (0, -1.55, 0.05), 0.075, 0.06, seg=8)
    return m.done()


def _musket_metal():
    m = Mesh()
    m.cylinder((0, 0.05, 0.11), (0, -2.45, 0.13), 0.07, 0.06, seg=8)       # ствол
    m.cylinder((0, -2.45, 0.13), (0, -2.52, 0.13), 0.08, 0.08, seg=8)      # дульное утолщение
    m.box((-0.1, -0.05, 0.02), (0.02, 0.2, 0.12))                          # замок
    return m.done()


def _hc_wood():
    m = Mesh()
    m.cylinder((0, 1.3, -0.02), (0, -0.55, 0.05), 0.06, 0.065, seg=8)      # древко (под мышку / на плечо)
    return m.done()


def _hc_metal():
    m = Mesh()
    m.cylinder((0, -0.45, 0.07), (0, -1.55, 0.09), 0.16, 0.13, seg=10)     # толстый короткий ствол
    m.cylinder((0, -1.5, 0.09), (0, -1.62, 0.09), 0.17, 0.17, seg=10)      # дульное кольцо
    m.cylinder((0, -0.55, 0.07), (0, -0.45, 0.07), 0.19, 0.19, seg=10)     # казённое кольцо
    return m.done()


def _horn():
    m = Mesh()
    m.cylinder((0, 0.0, 0.0), (0.0, -0.45, -0.25), 0.11, 0.035, seg=8)
    return m.done()


def _halberd_wood():
    m = Mesh()
    m.cylinder((0, 0, -1.7), (0, 0, 3.3), 0.05, 0.045, seg=6, vrep=3)       # древко вдоль +Z, как у копий 0 A.D.
    return m.done()


def _halberd_metal():
    m = Mesh()
    m.box((-0.025, 0.04, 2.7), (0.025, 0.5, 3.2))                         # лезвие топора
    m.box((-0.025, 0.4, 2.6), (0.025, 0.55, 3.3))                         # выпуклая кромка
    m.box((-0.02, -0.32, 2.9), (0.02, -0.04, 3.02))                       # крюк-клюв сзади
    m.cylinder((0, 0, 3.2), (0, 0, 3.85), 0.06, 0.005, seg=6)              # верхнее остриё
    return m.done()


# ------------------------------------------------------------------ бомбарда
# Корень машины: X — ось колёс, −Y — вперёд (к дулу), Z — вверх, земля z=0. Колёса r=0.9.
_WR = 0.9
_WX = 1.05


def _wheel(side, ang):
    """Колесо: обод-цилиндр (толстый диск) + 6 спиц; ang — поворот вокруг оси X."""
    m = Mesh()
    x = side * _WX
    m.cylinder((x - 0.12, 0, _WR), (x + 0.12, 0, _WR), _WR, _WR, seg=16, caps=False, urep=4)
    m.cylinder((x - 0.10, 0, _WR), (x + 0.10, 0, _WR), _WR * 0.82, _WR * 0.82, seg=16, caps=False, urep=4)
    ca, sa = math.cos(ang), math.sin(ang)
    for k in range(6):
        a = ang + k * math.pi / 3
        d = np.array([0.0, math.cos(a), math.sin(a)])
        m.cylinder((x, 0, _WR), np.array((x, 0, _WR)) + d * _WR * 0.85, 0.05, 0.045, seg=5, caps=False)
    m.cylinder((x - 0.2, 0, _WR), (x + 0.2, 0, _WR), 0.16, 0.16, seg=8)        # ступица
    del ca, sa
    return m.done()


def _carriage():
    m = Mesh()
    # станины (две балки) от оси назад к земле, поперечины, ось
    for s in (-1, 1):
        th = -math.atan2(_WR - 0.1, 2.6)          # хвост станины опускается к земле позади (+Y)
        M = np.eye(4)
        c, sn = math.cos(th), math.sin(th)
        # балка вдоль +Y, наклонена вниз к хвосту
        M[:3, :3] = np.array([[1, 0, 0], [0, c, -sn], [0, sn, c]]) @ np.eye(3)
        M[:3, 3] = (s * 0.42, 0.0, _WR + 0.05)
        m.box((-0.12, -0.9, -0.14), (0.12, 2.75, 0.14), M=M, rep=(1, 3))
    m.box((-0.55, -0.7, _WR + 0.08), (0.55, -0.35, _WR + 0.24))
    m.box((-0.45, 1.2, 0.55), (0.45, 1.45, 0.7))
    m.cylinder((-_WX, 0, _WR), (_WX, 0, _WR), 0.1, 0.1, seg=8)
    return m.done()


def _barrel(recoil):
    m = Mesh()
    y = recoil
    m.cylinder((0, 0.75 + y, _WR + 0.55), (0, -2.35 + y, _WR + 0.48), 0.38, 0.32, seg=14, urep=2)
    for yy, r in ((0.7, 0.44), (-0.1, 0.42), (-0.9, 0.4), (-1.7, 0.38), (-2.3, 0.4)):
        m.cylinder((0, yy + y + 0.1, _WR + 0.55 - (0.75 - yy) * 0.023), (0, yy + y - 0.1, _WR + 0.55 - (0.75 - yy) * 0.023),
                   r, r, seg=14)
    m.cylinder((0, 0.75 + y, _WR + 0.55), (0, 1.05 + y, _WR + 0.57), 0.3, 0.12, seg=10)   # казённая часть
    return m.done()


def _ship_cannons():
    """Стволы, торчащие из портов по бортам: координаты корпуса (длина по ±Y, ширина по X) задаёт
    множитель пропа; здесь — единичный корабль длиной 2 (y ∈ [−1, 1]), полуширина 0.27, высота борта 0.2."""
    m = Mesh()
    for s in (-1, 1):
        for k in range(4):
            y = -0.5 + k * 0.33
            m.cylinder((s * 0.2, y, 0.2), (s * 0.4, y, 0.215), 0.05, 0.042, seg=8)
            m.cylinder((s * 0.39, y, 0.215), (s * 0.41, y, 0.215), 0.055, 0.055, seg=8)
    return m.done()


# ------------------------------------------------------------------ клинки и шлемы (узнаваемость, 06_units_recognition)
# Оружие — как мечи 0 A.D.: клинок вдоль +Z, ширина по Y, плоскость клинка ⟂ X; шлем — в координатах точки
# 'helmet' (голова ≈ z 0.1…0.75, лицо к −Y). Всё нарочно крупнее реального: в спрайте 21 px клинок ≥ 2 px.
def _stack(m, rings, seg=12, y=0.0):
    """Тело вращения вокруг оси Z: rings — [(z, r), …] снизу вверх."""
    for (z0, r0), (z1, r1) in zip(rings, rings[1:]):
        m.cylinder((0, y, z0), (0, y, z1), max(r0, 1e-3), max(r1, 1e-3), seg=seg, caps=False)


def _greatsword_blade():
    m = Mesh()
    m.box((-0.045, -0.17, 0.35), (0.045, 0.17, 2.75), rep=(1, 4))
    m.box((-0.1, -0.045, 0.35), (0.1, 0.045, 2.75), rep=(1, 4))            # ребро: ширина видна и с торца
    m.cylinder((0, 0, 2.75), (0, 0, 3.08), 0.17, 0.01, seg=4)               # остриё
    return m.done()


def _greatsword_hilt():
    m = Mesh()
    m.cylinder((0, 0, -0.5), (0, 0, 0.26), 0.06, 0.06, seg=6)               # рукоять
    m.box((-0.06, -0.44, 0.24), (0.06, 0.44, 0.35))                         # гарда
    m.cylinder((0, 0, -0.62), (0, 0, -0.48), 0.1, 0.1, seg=8)               # навершие
    return m.done()


def _katana_blade():
    m = Mesh()
    n = 10
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        z0, z1 = 0.32 + 2.1 * t0, 0.32 + 2.1 * t1
        y0, y1 = 0.18 * t0 * t0, 0.18 * t1 * t1          # изгиб к обуху
        w = 0.075 * (1.0 - 0.35 * t1)
        yy = (y0 + y1) / 2
        m.box((-0.03, yy - w, z0), (0.03, yy + w, z1))
    return m.done()


def _katana_hilt():
    m = Mesh()
    m.cylinder((0, 0, -0.62), (0, 0, 0.28), 0.055, 0.055, seg=6)
    m.cylinder((0, 0, 0.24), (0, 0, 0.3), 0.15, 0.15, seg=10)                # цуба
    return m.done()


def _kettle():
    m = Mesh()
    m.cylinder((0, -0.02, 0.38), (0, -0.02, 0.43), 0.56, 0.54, seg=16)       # широкие поля
    _stack(m, [(0.42, 0.3), (0.6, 0.29), (0.72, 0.22), (0.8, 0.1), (0.82, 0.01)], y=-0.02)
    return m.done()


def _greathelm():
    m = Mesh()
    _stack(m, [(0.12, 0.3), (0.7, 0.29), (0.8, 0.2), (0.82, 0.01)], seg=14)
    return m.done()


def _greathelm_slit():
    m = Mesh()
    m.box((-0.21, -0.32, 0.47), (0.21, -0.26, 0.53))                        # смотровая щель
    return m.done()


def _greathelm_cross():
    m = Mesh()
    m.box((-0.035, -0.325, 0.16), (0.035, -0.27, 0.45))
    m.box((-0.17, -0.325, 0.34), (0.17, -0.27, 0.4))
    return m.done()


def _kabuto():
    m = Mesh()
    _stack(m, [(0.42, 0.3), (0.6, 0.28), (0.72, 0.19), (0.79, 0.06), (0.8, 0.01)])
    m.cylinder((0, 0.02, 0.46), (0, 0.04, 0.2), 0.31, 0.48, seg=14, caps=False)   # сикоро (назатыльник)
    return m.done()


def _kabuto_horns():
    m = Mesh()
    for s in (-1, 1):                                                        # кувагата — рога-«V»
        m.cylinder((s * 0.05, -0.3, 0.5), (s * 0.34, -0.38, 1.12), 0.045, 0.03, seg=5)
    m.box((-0.08, -0.34, 0.46), (0.08, -0.28, 0.58))
    return m.done()


def _morion():
    m = Mesh()
    m.cylinder((0, 0, 0.38), (0, 0, 0.42), 0.5, 0.47, seg=16)
    _stack(m, [(0.41, 0.29), (0.6, 0.26), (0.7, 0.17), (0.74, 0.02)])
    m.box((-0.03, -0.26, 0.55), (0.03, 0.26, 0.9))                          # гребень
    return m.done()


def _plume():
    m = Mesh()
    m.cylinder((0, 0.05, 0.7), (0, 0.25, 1.25), 0.07, 0.16, seg=8)
    return m.done()


def _stole():
    """Широкая стола/оплечье цвета игрока (плащ на плечи): полукольцо вокруг шеи, свисает вперёд и назад."""
    m = Mesh()
    for s in (-1, 1):
        m.box((s * 0.12 - 0.09, -0.36, -1.1), (s * 0.12 + 0.09, -0.3, 0.15))
        m.box((s * 0.12 - 0.09, 0.26, -1.1), (s * 0.12 + 0.09, 0.32, 0.15))
    return m.done()


# ------------------------------------------------------------------ акторы
# имя → список деталей: (меш, текстура); анимация — (имя состояния → длительность) для процедурных движений
ACTORS = {
    '@musket': [('@m/musket_wood', '@tex/wood'), ('@m/musket_metal', '@tex/steel')],
    '@musket_dark': [('@m/musket_wood', '@tex/wood'), ('@m/musket_metal', '@tex/iron')],
    '@handcannon': [('@m/hc_wood', '@tex/wood'), ('@m/hc_metal', '@tex/bronze')],
    '@powderhorn': [('@m/horn', '@tex/horn')],
    '@halberd': [('@m/halberd_wood', '@tex/wood'), ('@m/halberd_metal', '@tex/steel')],
    '@bombard': [('@m/carriage', '@tex/wood'), ('@m/wheel_l', '@tex/wood'), ('@m/wheel_r', '@tex/wood'),
                 ('@m/barrel', '@tex/iron')],
    '@ship_cannons': [('@m/ship_cannons', '@tex/steel')],
    '@greatsword': [('@m/gs_blade', '@tex/steel'), ('@m/gs_hilt', '@tex/gold')],
    '@katana': [('@m/katana_blade', '@tex/steel'), ('@m/katana_hilt', '@tex/dark')],
    '@kettle': [('@m/kettle', '@tex/steel')],
    '@greathelm': [('@m/greathelm', '@tex/steel'), ('@m/greathelm_slit', '@tex/dark'),
                   ('@m/greathelm_cross', '@tex/gold')],
    '@kabuto': [('@m/kabuto', '@tex/iron'), ('@m/kabuto_horns', '@tex/gold')],
    '@morion': [('@m/morion', '@tex/steel')],
    '@plume_player': [('@m/plume', '@tex/player')],
    '@stole': [('@m/stole', '@tex/player')],
}
_STATIC = {'@m/musket_wood': _musket_wood, '@m/musket_metal': _musket_metal, '@m/hc_wood': _hc_wood,
           '@m/hc_metal': _hc_metal, '@m/horn': _horn,
           '@m/halberd_wood': _halberd_wood, '@m/halberd_metal': _halberd_metal, '@m/carriage': _carriage,
           '@m/ship_cannons': _ship_cannons, '@m/gs_blade': _greatsword_blade, '@m/gs_hilt': _greatsword_hilt,
           '@m/katana_blade': _katana_blade, '@m/katana_hilt': _katana_hilt, '@m/kettle': _kettle,
           '@m/greathelm': _greathelm, '@m/greathelm_slit': _greathelm_slit, '@m/greathelm_cross': _greathelm_cross,
           '@m/kabuto': _kabuto, '@m/kabuto_horns': _kabuto_horns, '@m/morion': _morion, '@m/plume': _plume,
           '@m/stole': _stole}
_CACHE = {}
ANIMATED = {'@bombard'}          # акторы с процедурными движениями (колёса, откат)
# длительность цикла процедурных анимаций (с)
DUR = {'walk': 1.2, 'attack_ranged': 1.6, 'attack_melee': 1.6, 'idle': 1.0}


def shape(kind, a, b):
    """Деталь в коробке [a, b] координат модели (−Y — перёд): см. build_units.extra_parts."""
    a = np.asarray(a, np.float64)
    b = np.asarray(b, np.float64)
    lo, hi = np.minimum(a, b), np.maximum(a, b)
    c = (lo + hi) / 2
    sz = hi - lo
    m = Mesh()
    if kind == 'box':
        m.box(lo, hi)
    elif kind == 'cyl_y':
        r = min(sz[0], sz[2]) / 2
        m.cylinder((c[0], hi[1], c[2]), (c[0], lo[1], c[2]), r, r, seg=10, urep=2, vrep=3)
    elif kind == 'cyl_z':
        r = min(sz[0], sz[1]) / 2
        m.cylinder((c[0], c[1], lo[2]), (c[0], c[1], hi[2]), r, r * 0.8, seg=8, urep=1, vrep=4)
    elif kind == 'ram_head':
        # голова барана: утолщение на конце бревна (−Y) и два завитка рогов по бокам
        r = min(sz[0], sz[2]) / 2
        m.cylinder((c[0], hi[1], c[2]), (c[0], lo[1] + sz[1] * 0.25, c[2]), r * 0.7, r, seg=10)
        m.cylinder((c[0], lo[1] + sz[1] * 0.25, c[2]), (c[0], lo[1], c[2]), r, r * 0.55, seg=10)
        for s in (-1, 1):
            m.cylinder((c[0] + s * r * 0.6, lo[1] + sz[1] * 0.45, c[2] + r * 0.3),
                       (c[0] + s * r * 1.35, lo[1] + sz[1] * 0.2, c[2] - r * 0.4), r * 0.42, r * 0.3, seg=8)
    elif kind == 'tent':
        # полуцилиндр вдоль Y: дуги поперёк, 10 сегментов
        n = 10
        for i in range(n):
            a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
            p0 = (c[0] + math.cos(a0) * sz[0] / 2, lo[2] + math.sin(a0) * sz[2])
            p1 = (c[0] + math.cos(a1) * sz[0] / 2, lo[2] + math.sin(a1) * sz[2])
            nm = np.array([math.cos((a0 + a1) / 2), 0.0, math.sin((a0 + a1) / 2)])
            m.quad((p0[0], lo[1], p0[1]), (p1[0], lo[1], p1[1]), (p1[0], hi[1], p1[1]), (p0[0], hi[1], p0[1]), nm,
                   uv=((0, 0), (1, 0), (1, 3), (0, 3)))
    elif kind == 'sail_lat':
        # косой (латинский) парус: треугольник в плоскости YZ — вершина наверху впереди
        top = np.array([c[0], lo[1], hi[2]])
        b0 = np.array([c[0], lo[1] + sz[1] * 0.15, lo[2]])
        b1 = np.array([c[0], hi[1], lo[2] + sz[2] * 0.1])
        nm = np.array([1.0, 0.0, 0.0])
        m.tri(top, b0, b1, nm, nm, nm, (0.5, 1), (0, 0), (1, 0))
        m.tri(top, b1, b0, -nm, -nm, -nm, (0.5, 1), (1, 0), (0, 0))
    elif kind == 'barrels':
        # бочки пороха: 2 ряда по 3
        r = min(sz[0] / 4.4, sz[1] / 6.6)
        for i in range(3):
            for j in range(2):
                x = c[0] + (j - 0.5) * r * 2.2
                y = lo[1] + sz[1] * (i + 0.5) / 3
                m.cylinder((x, y, lo[2]), (x, y, lo[2] + sz[2]), r, r * 1.05, seg=10)
    elif kind == 'siphon':
        r = min(sz[0], sz[2]) / 2
        m.cylinder((c[0], hi[1], c[2]), (c[0], lo[1], c[2] + sz[2] * 0.3), r, r * 0.7, seg=8)
        m.cylinder((c[0], lo[1] + sz[1] * 0.08, c[2] + sz[2] * 0.28), (c[0], lo[1], c[2] + sz[2] * 0.3),
                   r * 1.3, r * 1.3, seg=8)
    else:
        raise KeyError(kind)
    return m.done()


def is_proc(actor):
    return isinstance(actor, str) and actor.startswith('@')


def mesh(name, anim=None, frac=0.0):
    """Геометрия процедурного меша (в позе анимации anim в доле цикла frac)."""
    if name in _STATIC:
        if name not in _CACHE:
            _CACHE[name] = _STATIC[name]()
        return _CACHE[name]
    if name in ('@m/wheel_l', '@m/wheel_r'):
        side = -1 if name.endswith('_l') else 1
        # колесо катится: путь за цикл = длине окружности × 1 оборот (шаг задаёт stride)
        ang = -2 * math.pi * frac if anim == 'walk' else 0.0
        key = (name, round(ang, 4))
        if key not in _CACHE:
            _CACHE[key] = _wheel(side, ang)
        return _CACHE[key]
    if name == '@m/barrel':
        rec = 0.0
        if anim and anim.startswith('attack'):
            # выстрел в момент 0.35 цикла: резкий откат, медленный накат
            f = (frac - 0.35) % 1.0
            rec = 0.45 * math.exp(-f * 6.0) if f < 0.9 else 0.0
        key = (name, round(rec, 4))
        if key not in _CACHE:
            _CACHE[key] = _barrel(rec)
        return _CACHE[key]
    return None


def stride(actor):
    """Путь за цикл 'walk' (ед. модели) для процедурных машин: одна длина окружности колеса."""
    if actor == '@bombard':
        return 2 * math.pi * _WR
    return 0.0
