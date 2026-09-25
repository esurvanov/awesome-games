"""The game's projection and lighting parameters - common to all renders.

The ground - cell coordinates (gx, gy), the height gz in the same cells, Z up.
Screen (like game.data.to_iso, but in cells): sx = (gx - gy)*HW, sy = (gx + gy)*HH - gz*ZK.
This is a true orthographic projection: the camera looks along -V, V = (1, 1, sqrt(2/3)*...) - an elevation angle of 30 deg,
a rotation of 45 deg; one cell is a 64x32 diamond; a cell's vertical is ZK = 32*sqrt(2)*cos30 deg ~ 39.19 px.
"""
import math

import numpy as np

HW, HH = 32, 16
ELEV = math.radians(30.0)
K = HW / math.cos(math.pi / 4)            # pixels per cell along the horizontal perpendicular to the ray
ZK = K * math.cos(ELEV)                   # pixels per cell of height (~ 39.19)

# the unit vector "toward the viewer" in ground coordinates
VIEW = np.array([1.0, 1.0, 2 * HH / ZK], dtype=np.float64)
VIEW /= np.linalg.norm(VIEW)

# the sun: at the upper right of the screen, high (as in AoE II DE): shadows fall to the left (slightly down), the shadow length ~ 0.55
# of the object's height; the right faces (normal +X) are lit, the left ones (normal +Y) are in half-shade
SUN = np.array([0.5, -0.55, 1.5], dtype=np.float64)
SUN /= np.linalg.norm(SUN)


def project(p):
    """(N,3) ground -> (N,2) screen pixels (without an offset)."""
    p = np.asarray(p, dtype=np.float64)
    return np.stack([(p[:, 0] - p[:, 1]) * HW, (p[:, 0] + p[:, 1]) * HH - p[:, 2] * ZK], axis=1)


def view_depth(p):
    """The larger, the closer to the viewer."""
    return np.asarray(p, dtype=np.float64) @ VIEW


def light_basis(L=SUN):
    f = -np.asarray(L, dtype=np.float64)
    r = np.cross(f, [0.0, 0.0, 1.0])
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return r, u, np.asarray(L, dtype=np.float64)


def shadow_on_ground(p, L=SUN):
    """Projecting points onto the plane z=0 along the sun ray."""
    p = np.asarray(p, dtype=np.float64)
    t = p[:, 2:3] / L[2]
    return p - t * L[None, :]


def placement(scale, yaw_deg=0.0, center=(0.0, 0.0), model_center=(0.0, 0.0), mirror=False, z0=0.0):
    """A 4x4 matrix: model coordinates (Z up, as in COLLADA) -> the ground in cells.

    The model is rotated by yaw about Z, scaled, its point model_center (in model coordinates,
    before rotation) is moved to center (cells)."""
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
