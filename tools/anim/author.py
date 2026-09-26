"""Key-pose authoring on the UAL skeleton: an existing base clip (idle breathing etc.) + keyed layers
(pelvis offset/tilt, spine bend, head look, hand IK targets with palm orientation, foot IK targets).
Coordinates: character space, origin between the feet on the ground, facing +Z, left = +X, metres (pilot native = 1.90 m tall).
"""
import numpy as np
from gltfio import *
from retarget import world, two_bone_ik, set_world_pelvis

DEG = np.pi / 180

def interp_keys(keys, ts, dim):
    """keys: list of (t, value) ; Catmull-Rom (C1) through keys, clamped at ends. value scalar or vector"""
    kt = np.array([k[0] for k in keys], float)
    kv = np.array([np.atleast_1d(np.asarray(k[1], float)) for k in keys])
    out = np.zeros((len(ts), kv.shape[1]))
    if len(keys) == 1: out[:] = kv[0]; return out if dim > 1 else out[:, 0]
    for n, t in enumerate(ts):
        if t <= kt[0]: out[n] = kv[0]; continue
        if t >= kt[-1]: out[n] = kv[-1]; continue
        i = np.searchsorted(kt, t) - 1
        t0, t1 = kt[i], kt[i + 1]; u = (t - t0) / (t1 - t0)
        p0, p1 = kv[i], kv[i + 1]
        # tangents (finite difference, zero at ends -> ease in/out on first/last key)
        m0 = (kv[i + 1] - kv[i - 1]) / (kt[i + 1] - kt[i - 1]) * (t1 - t0) if i > 0 else np.zeros_like(p0)
        m1 = (kv[i + 2] - kv[i]) / (kt[i + 2] - kt[i]) * (t1 - t0) if i + 2 < len(kt) else np.zeros_like(p0)
        # monotone: no overshoot past a key that is a local extremum (per component); holds stay flat
        if i > 0: m0 = np.where((kv[i] - kv[i - 1]) * (kv[i + 1] - kv[i]) <= 0, 0, m0)
        if i + 2 < len(kt): m1 = np.where((kv[i + 1] - kv[i]) * (kv[i + 2] - kv[i + 1]) <= 0, 0, m1)
        if np.allclose(p0, p1): m0 = m1 = np.zeros_like(p0)
        h00 = 2 * u ** 3 - 3 * u ** 2 + 1; h10 = u ** 3 - 2 * u ** 2 + u; h01 = -2 * u ** 3 + 3 * u ** 2; h11 = u ** 3 - u ** 2
        out[n] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1
    return out if dim > 1 else out[:, 0]

def euler_q(pitch, yaw, roll):
    """character-space rotation: yaw about +Y, then pitch about +X (forward bend +), roll about +Z (lean to char right +)"""
    F = len(pitch)
    X = qaxis(np.repeat([[1, 0, 0.0]], F, 0), pitch); Y = qaxis(np.repeat([[0, 1, 0.0]], F, 0), yaw); Z = qaxis(np.repeat([[0, 0, 1.0]], F, 0), roll)
    return qmul(Y, qmul(X, Z))

def rotate_world(tg, clip, bone, qw, pivot_keep=True):
    """pre-multiply bone's world rotation by qw [F,4] (children follow)"""
    sk = tg.sk; i = tg.i(bone); p = sk.parent[i]
    Pw, Qw = world(tg, clip)
    new = qmul(qw, Qw[:, i])
    clip['R'][:, i] = qmul(qinv(Qw[:, p]), new)

def set_world_rot(tg, clip, bone, qw, w=None):
    sk = tg.sk; i = tg.i(bone); p = sk.parent[i]
    Pw, Qw = world(tg, clip)
    tgt = qw if w is None else qslerp(Qw[:, i], qw, np.clip(w, 0, 1))
    clip['R'][:, i] = qmul(qinv(Qw[:, p]), tgt)

def hand_rot(tg, side, palm_n, finger_d):
    """world rotation for hand_<side> so the palm faces palm_n and fingers point along finger_d. [F,3] each"""
    i = tg.i('hand_' + side)
    f_rest = tg.Pw[tg.i('middle_01_' + side)] - tg.Pw[i]; f_rest /= np.linalg.norm(f_rest)
    p_rest = np.array([0, -1.0, 0]); p_rest = p_rest - f_rest * np.dot(p_rest, f_rest); p_rest /= np.linalg.norm(p_rest)
    def basis(f, p):
        f = f / np.linalg.norm(f, axis=-1, keepdims=True)
        p = p - f * np.sum(p * f, -1, keepdims=True); p = p / np.linalg.norm(p, axis=-1, keepdims=True)
        return np.stack([f, p, np.cross(f, p)], -1)   # columns
    B1 = basis(np.asarray(finger_d, float), np.asarray(palm_n, float))
    B0 = basis(f_rest[None], p_rest[None])[0]
    M = B1 @ B0.T
    return qmul(mat_to_q(M), tg.Qw[i][None])

def flatten_fingers(tg, clip, side, w):
    """blend finger locals towards rest (straight, flat palm for pressing on a surface)"""
    for nm in tg.sk.names:
        if nm.endswith('_' + side) and any(x in nm for x in ('index', 'middle', 'ring', 'pinky')) and 'leaf' not in nm:
            i = tg.i(nm)
            clip['R'][:, i] = qslerp(clip['R'][:, i], np.repeat(tg.sk.R[i][None], len(w), 0), np.clip(w, 0, 1))

def base_from(tg, T, R, dur, fps=30, t_off=0.0):
    """tile/loop a base clip (local T,R sampled at fps) to duration"""
    F = int(round(dur * fps)) + 1
    n = T.shape[0]
    idx = (np.arange(F) + int(round(t_off * fps))) % (n - 1)
    return dict(times=np.arange(F) / fps, T=T[idx].copy(), R=R[idx].copy(), fps=fps)

def author(tg, base, keys, ctrl_fps=30):
    """keys: dict of layer -> list[(t, value)]
       pelvis_off (dx,dy,dz), pelvis_rot (pitch,yaw,roll deg), spine (pitch,yaw,roll deg, spread over spine_01..03),
       neck (pitch,yaw,roll deg), clav_l/clav_r (raise deg), hand_l/hand_r (x,y,z), hand_l_w/hand_r_w (0..1),
       palm_l/palm_r (nx,ny,nz), fingers_l/fingers_r (dx,dy,dz), foot_l/foot_r (x,y,z) absolute, foot_*_w,
       foot_l_rot/foot_r_rot (pitch deg), knee_l/knee_r pole (x,y,z dir), elbow_l/elbow_r pole dir"""
    c = base; ts = c['times']; F = len(ts)
    g = lambda k, d, dim=3: interp_keys(keys[k], ts, dim) if k in keys else (np.tile(np.asarray(d, float), (F, 1)) if dim > 1 else np.full(F, d, float))
    Pw0, Qw0 = world(tg, c)
    feet0 = {s: Pw0[:, tg.i('foot_' + s)].copy() for s in 'lr'}
    footQ0 = {s: Qw0[:, tg.i('foot_' + s)].copy() for s in 'lr'}
    # pelvis
    off = g('pelvis_off', [0, 0, 0]); pr = g('pelvis_rot', [0, 0, 0]) * DEG
    ip = tg.i('pelvis')
    set_world_pelvis(tg, c, Pw0[:, ip] + off)
    rotate_world(tg, c, 'pelvis', euler_q(pr[:, 0], pr[:, 1], pr[:, 2]))
    # spine
    sp = g('spine', [0, 0, 0]) * DEG
    for b in ('spine_01', 'spine_02', 'spine_03'):
        rotate_world(tg, c, b, euler_q(sp[:, 0] / 3, sp[:, 1] / 3, sp[:, 2] / 3))
    nk = g('neck', [0, 0, 0]) * DEG
    for b in ('neck_01', 'Head'):
        rotate_world(tg, c, b, euler_q(nk[:, 0] / 2, nk[:, 1] / 2, nk[:, 2] / 2))
    for s, sgn in (('l', 1), ('r', -1)):
        if 'clav_' + s in keys:
            a = g('clav_' + s, 0, 1) * DEG
            rotate_world(tg, c, 'clavicle_' + s, qaxis(np.repeat([[0, 0, 1.0]], F, 0), a * sgn))
    # legs
    for s in 'lr':
        tgt = g('foot_' + s, None) if 'foot_' + s in keys else feet0[s]
        w = np.clip(g('foot_%s_w' % s, 1.0, 1), 0, 1)
        toe = (Pw0[:, tg.i('ball_' + s)] - Pw0[:, tg.i('foot_' + s)]) * np.array([1, 0, 1.0])
        toe = toe / np.linalg.norm(toe, axis=-1, keepdims=True) + np.array([0, 0.15, 0])   # knees over the toes
        pole = g('knee_' + s, [0, 0, 1]) if 'knee_' + s in keys else toe
        two_bone_ik(tg, c, ('thigh_' + s, 'calf_' + s, 'foot_' + s), tgt, w, pole=pole, hint_pole_only=True)
        fr = g('foot_%s_rot' % s, 0, 1) * DEG
        set_world_rot(tg, c, 'foot_' + s, qmul(qaxis(np.repeat([[1, 0, 0.0]], F, 0), fr), footQ0[s]))
    # arms
    for s, sgn in (('l', 1), ('r', -1)):
        if 'hand_' + s not in keys: continue
        tgt = g('hand_' + s, None); w = np.clip(g('hand_%s_w' % s, 1.0, 1), 0, 1)
        pole = g('elbow_' + s, [sgn * 0.6, -0.5, -0.6])
        two_bone_ik(tg, c, ('upperarm_' + s, 'lowerarm_' + s, 'hand_' + s), tgt, w, pole=pole)
        if 'palm_' + s in keys:
            qh = hand_rot(tg, s, g('palm_' + s, None), g('fingers_' + s, [0, 1, 0]))
            set_world_rot(tg, c, 'hand_' + s, qh, w)
            flatten_fingers(tg, c, s, w * g('flat_' + s, 1.0, 1))
    return c

def add_noise_layer(tg, clip, bones, amp_deg, hz, seed=1):
    """periodic (loop-safe) tremor: sum of sines with integer cycles over the clip"""
    ts = clip['times']; T = ts[-1]; F = len(ts); rng = np.random.default_rng(seed)
    for b in bones:
        ang = np.zeros((F, 3))
        for k in range(3):
            for h in (1.0, 1.37, 1.81):
                cyc = max(1, round(hz * h * T)); ph = rng.uniform(0, 2 * np.pi)
                ang[:, k] += np.sin(2 * np.pi * cyc * ts / T + ph) / 3
        ang *= amp_deg * DEG
        rotate_world(tg, clip, b, euler_q(ang[:, 0], ang[:, 1], ang[:, 2]))
