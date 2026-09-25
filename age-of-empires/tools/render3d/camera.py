"""Проекция игры и параметры освещения — общие для всех рендеров.

Земля — координаты клеток (gx, gy), высота gz в тех же клетках, Z вверх.
Экран (как game.data.to_iso, но в клетках): sx = (gx − gy)·HW, sy = (gx + gy)·HH − gz·ZK.
Это честная ортографическая проекция: камера смотрит вдоль −V, V = (1, 1, √(2/3)·…) — угол возвышения 30°,
поворот 45°; одна клетка — ромб 64×32; вертикаль клетки — ZK = 32·√2·cos30° ≈ 39.19 px.
"""
import math

import numpy as np

HW, HH = 32, 16
ELEV = math.radians(30.0)
K = HW / math.cos(math.pi / 4)            # пикселей на клетку вдоль горизонтали, перпендикулярной лучу
ZK = K * math.cos(ELEV)                   # пикселей на клетку высоты (≈ 39.19)

# единичный вектор «к зрителю» в координатах земли
VIEW = np.array([1.0, 1.0, 2 * HH / ZK], dtype=np.float64)
VIEW /= np.linalg.norm(VIEW)

# солнце: справа-сверху экрана, высоко (как в AoE II DE): тени падают влево (чуть вниз), длина тени ≈ 0.55
# высоты предмета; правые (нормаль +X) грани освещены, левые (нормаль +Y) — в полутени
SUN = np.array([0.5, -0.55, 1.5], dtype=np.float64)
SUN /= np.linalg.norm(SUN)


def project(p):
    """(N,3) земля → (N,2) экранные пиксели (без сдвига)."""
    p = np.asarray(p, dtype=np.float64)
    return np.stack([(p[:, 0] - p[:, 1]) * HW, (p[:, 0] + p[:, 1]) * HH - p[:, 2] * ZK], axis=1)


def view_depth(p):
    """Чем больше, тем ближе к зрителю."""
    return np.asarray(p, dtype=np.float64) @ VIEW


def light_basis(L=SUN):
    f = -np.asarray(L, dtype=np.float64)
    r = np.cross(f, [0.0, 0.0, 1.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return r, u, np.asarray(L, dtype=np.float64)


def shadow_on_ground(p, L=SUN):
    """Проекция точек на плоскость z=0 вдоль луча солнца."""
    p = np.asarray(p, dtype=np.float64)
    t = p[:, 2:3] / L[2]
    return p - t * L[None, :]


def placement(scale, yaw_deg=0.0, center=(0.0, 0.0), model_center=(0.0, 0.0), mirror=False, z0=0.0):
    """Матрица 4×4: координаты модели (Z вверх, как в COLLADA) → земля в клетках.

    Модель поворачивается на yaw вокруг Z, масштабируется, её точка model_center (в координатах модели,
    до поворота) переносится в center (клетки)."""
    a = math.radians(yaw_deg)
    c, s = math.cos(a), math.sin(a)
    R = np.array([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=np.float64)
    if mirror:
        R = R @ np.diag([-1.0, 1.0, 1.0, 1.0])
    S = np.diag([scale, scale, scale, 1.0])
    T0 = np.eye(4)
    T0[:2, 3] = [-model_center[0], -model_center[1]]
    T1 = np.eye(4)
    T1[:3, 3] = [center[0], center[1], z0]
    return T1 @ S @ R @ T0
