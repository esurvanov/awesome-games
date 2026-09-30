"""CMU (DAZ-named cgspeed skeleton, dumped by fbx_dump.py) -> Quaternius UAL skeleton (pilot / hermit) retargeter.

Method: per-bone world-rotation transfer with a *direction-matched* reference pose.
  For every mapped bone t<-s we build a target reference rotation Rref_t = swing(dir_t_rest -> dir_s_rest) * Rrest_t,
  i.e. the target rest pose bent so each bone points where the source bone points in the source rest pose.
  Per frame: Rw_t(f) = Rw_s(f) * Rw_s_rest^-1 * Rref_t   (so every target bone points exactly along its source bone)
  Locals: L_t = Rw_parent^-1 * Rw_t. Pelvis translation = source hip path * leg-length ratio.
Everything is world space glTF Y-up metres, character facing +Z, left = +X.
"""
import numpy as np
from gltfio import *

SRC_MAP = {  # target : source
    'pelvis': 'hip', 'spine_01': 'abdomen', 'spine_03': 'chest', 'neck_01': 'neck', 'Head': 'head',
    'clavicle_l': 'lCollar', 'upperarm_l': 'lShldr', 'lowerarm_l': 'lForeArm', 'hand_l': 'lHand',
    'clavicle_r': 'rCollar', 'upperarm_r': 'rShldr', 'lowerarm_r': 'rForeArm', 'hand_r': 'rHand',
    'thigh_l': 'lThigh', 'calf_l': 'lShin', 'foot_l': 'lFoot', 'thigh_r': 'rThigh', 'calf_r': 'rShin', 'foot_r': 'rFoot'}
TGT_CHILD = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_03': 'neck_01', 'neck_01': 'Head',
             'clavicle_l': 'upperarm_l', 'upperarm_l': 'lowerarm_l', 'lowerarm_l': 'hand_l', 'hand_l': 'middle_01_l',
             'clavicle_r': 'upperarm_r', 'upperarm_r': 'lowerarm_r', 'lowerarm_r': 'hand_r', 'hand_r': 'middle_01_r',
             'thigh_l': 'calf_l', 'calf_l': 'foot_l', 'foot_l': 'ball_l', 'thigh_r': 'calf_r', 'calf_r': 'foot_r', 'foot_r': 'ball_r'}
SRC_CHILD = {'hip': 'abdomen', 'abdomen': 'chest', 'chest': 'neck', 'neck': 'head',
             'lCollar': 'lShldr', 'lShldr': 'lForeArm', 'lForeArm': 'lHand', 'lHand': 'lMid1',
             'rCollar': 'rShldr', 'rShldr': 'rForeArm', 'rForeArm': 'rHand', 'rHand': 'rMid1',
             'lThigh': 'lShin', 'lShin': 'lFoot', 'rThigh': 'rShin', 'rShin': 'rFoot'}  # feet: own +Y axis

class Target:
    def __init__(self, glb):
        j, b = read_glb(glb)
        self.sk = Skeleton(j, b)
        sk = self.sk
        self.Pw, self.Qw = sk.fk(sk.T, sk.R)
        names = sk.anim_names()
        self.idle = None
        if 'Idle_Loop' in names:
            _, T, R = sk.sample(names.index('Idle_Loop'))
            self.idle = (T, R)
        self.leg = (np.linalg.norm(self.Pw[sk.idx['calf_l']] - self.Pw[sk.idx['thigh_l']]) +
                    np.linalg.norm(self.Pw[sk.idx['foot_l']] - self.Pw[sk.idx['calf_l']]))

    def i(self, n): return self.sk.idx[n]

def load_src(npz):
    d = np.load(npz)
    names = list(d['names']); mats = d['mats'].astype(np.float64); rest = d['rest'].astype(np.float64)
    return dict(names=names, idx={n: i for i, n in enumerate(names)}, P=mats[..., :3, 3] / 100.0, Q=mat_to_q(mats),
                Prest=rest[:, :3, 3] / 100.0, Qrest=mat_to_q(rest), Yax=mats[..., :3, 1], Yrest=rest[:, :3, 1], fps=float(d['fps']))

def yaw_of(q):
    f = qrot(q, np.array([0, 0, 1.0]))
    return np.arctan2(f[..., 0], f[..., 2])

def retarget(tg, src, f0=1, f1=None, fps=30.0, fingers='idle', face=True):
    sk = tg.sk; n = sk.n
    S = src; si = S['idx']
    F_src = S['P'].shape[0]; f1 = F_src - 1 if f1 is None else min(f1, F_src - 1)
    # resample source to fps
    ts = np.arange(f0 / S['fps'], f1 / S['fps'] + 1e-9, 1 / fps)
    u = ts * S['fps']; k = np.clip(np.floor(u).astype(int), 0, F_src - 1); k2 = np.clip(k + 1, 0, F_src - 1); a = (u - k)[:, None]
    SP = S['P'][k] * (1 - a[..., None]) + S['P'][k2] * a[..., None]
    SQ = qslerp(S['Q'][k], S['Q'][k2], np.repeat(a, S['Q'].shape[1], 1))
    SY = S['Yax'][k]
    F = len(ts)
    # source delta rotations
    D = {}
    for t, s in SRC_MAP.items():
        D[t] = qmul(SQ[:, si[s]], qinv(S['Qrest'][si[s]])[None])
    D['spine_02'] = qslerp(D['spine_01'], D['spine_03'], 0.5)
    # swing-aligned target reference rotations
    A = {}
    for t, s in SRC_MAP.items():
        if t == 'Head': continue
        dt = tg.Pw[tg.i(TGT_CHILD[t])] - tg.Pw[tg.i(t)]
        ds = S['Yrest'][si[s]] if s not in SRC_CHILD else S['Prest'][si[SRC_CHILD[s]]] - S['Prest'][si[s]]
        A[t] = qbetween(dt, ds)
    A['Head'] = A['neck_01']
    A['spine_02'] = qslerp(A['spine_01'], A['spine_03'], 0.5)
    # facing / origin normalisation
    yaw0 = yaw_of(D['pelvis'][0]) if face else 0.0
    Ynorm = qaxis([0, 1, 0], -yaw0)
    scale = tg.leg / (np.linalg.norm(S['Prest'][si['lShin']] - S['Prest'][si['lThigh']]) + np.linalg.norm(S['Prest'][si['lFoot']] - S['Prest'][si['lShin']]))
    hip = SP[:, si['hip']]
    org = hip[0] * np.array([1, 0, 1.0])
    hipN = qrot(np.repeat(Ynorm[None], F, 0), hip - org) * scale
    # local reference poses for unmapped bones
    Tl = np.repeat(sk.T[None], F, 0).copy(); Rl = np.repeat(sk.R[None], F, 0).copy()
    if fingers == 'idle' and tg.idle is not None:
        fi = [i for i, nm in enumerate(sk.names) if any(x in nm for x in ('thumb', 'index', 'middle', 'ring', 'pinky'))]
        Rl[:, fi] = tg.idle[1][0, fi]
    Qw = np.zeros((F, n, 4)); Pw = np.zeros((F, n, 3))
    for i in sk.order:
        nm = sk.names[i]; p = sk.parent[i]
        if nm in D:
            Qw[:, i] = qmul(qmul(Ynorm[None], D[nm]), qmul(A[nm], tg.Qw[i])[None])
            Rl[:, i] = qmul(qinv(Qw[:, p]), Qw[:, i]) if p >= 0 else Qw[:, i]
        else:
            Qw[:, i] = qmul(Qw[:, p], Rl[:, i]) if p >= 0 else Rl[:, i]
        if nm == 'pelvis':
            # hip joint position: source hip -> target pelvis, keep target's rest height offset ratio
            Pw[:, i] = hipN
            Tl[:, i] = qrot(qinv(Qw[:, p]), Pw[:, i] - Pw[:, p])
        else:
            Pw[:, i] = (Pw[:, p] + qrot(Qw[:, p], Tl[:, i])) if p >= 0 else Tl[:, i]
    clip = dict(times=ts - ts[0], T=Tl, R=Rl, fps=fps)
    ground_fix(tg, clip)
    return clip

def world(tg, clip):
    return tg.sk.fk(clip['T'], clip['R'])

def set_world_pelvis(tg, clip, Pw_pelvis):
    sk = tg.sk; i = tg.i('pelvis'); p = sk.parent[i]
    Pw, Qw = world(tg, clip)
    clip['T'][:, i] = qrot(qinv(Qw[:, p]), Pw_pelvis - Pw[:, p])

def ground_fix(tg, clip, pct=5):
    Pw, Qw = world(tg, clip)
    h = np.minimum.reduce([Pw[:, tg.i('foot_l'), 1] - tg.Pw[tg.i('foot_l'), 1], Pw[:, tg.i('foot_r'), 1] - tg.Pw[tg.i('foot_r'), 1],
                           Pw[:, tg.i('ball_l'), 1] - tg.Pw[tg.i('ball_l'), 1], Pw[:, tg.i('ball_r'), 1] - tg.Pw[tg.i('ball_r'), 1]])
    off = np.percentile(h, pct)
    pel = Pw[:, tg.i('pelvis')].copy(); pel[:, 1] -= off
    set_world_pelvis(tg, clip, pel)
    return off

# ---------------------------------------------------------------- IK
def two_bone_ik(tg, clip, chain, target, weight=None, pole=None, hint_pole_only=False):
    """chain = (upper, lower, end) bone names; target [F,3] world position for `end`; keeps end's world rotation.
    weight [F] in 0..1 blends original -> solved. pole [F,3] optional preferred mid-joint direction."""
    sk = tg.sk
    ia, ib, ic = [tg.i(n) for n in chain]
    Pw, Qw = world(tg, clip)
    F = Pw.shape[0]
    w = np.ones(F) if weight is None else np.asarray(weight, float)
    a, b, c = Pw[:, ia], Pw[:, ib], Pw[:, ic]
    endQ = Qw[:, ic].copy()
    la = np.linalg.norm(b - a, axis=-1); lb = np.linalg.norm(c - b, axis=-1)
    T = c + (target - c) * w[:, None]
    at = T - a; d = np.clip(np.linalg.norm(at, axis=-1), 1e-6, (la + lb) * 0.999)
    atn = at / np.linalg.norm(at, axis=-1, keepdims=True)
    # bend plane: current mid joint offset, blended with the pole hint (pole alone when the limb is ~straight)
    cur = (b - a) - np.sum((b - a) * atn, -1, keepdims=True) * atn
    cn = np.linalg.norm(cur, axis=-1, keepdims=True)
    if pole is None: pole = np.tile([0, 0, 1.0], (F, 1))
    pl = pole - np.sum(pole * atn, -1, keepdims=True) * atn; pl = pl / np.maximum(np.linalg.norm(pl, axis=-1, keepdims=True), 1e-9)
    if hint_pole_only: pv = pl
    else:
        k = np.clip(cn / (0.15 * la[:, None]), 0, 1)       # trust the current bend once it is clear (>~9 deg)
        pv = cur / np.maximum(cn, 1e-9) * k + pl * (1 - k)
    pn = np.linalg.norm(pv, axis=-1, keepdims=True); pv = np.where(pn > 1e-6, pv / np.maximum(pn, 1e-9), pl)
    cosA = np.clip((la ** 2 + d ** 2 - lb ** 2) / (2 * la * d), -1, 1); sinA = np.sqrt(1 - cosA ** 2)
    bn = a + (atn * cosA[:, None] + pv * sinA[:, None]) * la[:, None]
    cn = a + atn * d[:, None]
    # rotate upper
    r1 = qbetween(b - a, bn - a)
    Qa = qmul(r1, Qw[:, ia])
    # lower after parent change
    Qb0 = qmul(Qa, qmul(qinv(Qw[:, ia]), Qw[:, ib]))
    c_after = bn + qrot(Qb0, qrot(qinv(Qw[:, ib]), c - b))
    r2 = qbetween(c_after - bn, cn - bn)
    Qb = qmul(r2, Qb0)
    pa = sk.parent[ia]
    on = w > 1e-4   # untouched frames keep their exact source rotations
    clip['R'][on, ia] = qmul(qinv(Qw[on, pa]), Qa[on])
    clip['R'][on, ib] = qmul(qinv(Qa[on]), Qb[on])
    clip['R'][on, ic] = qmul(qinv(Qb[on]), endQ[on])
    return clip

def contacts(y, v, hthr, vthr, minlen=4):
    c = (y < hthr) & (v < vthr)
    # close small gaps, drop short runs
    out = c.copy(); F = len(c)
    i = 0; segs = []
    while i < F:
        if c[i]:
            j = i
            while j + 1 < F and c[j + 1]: j += 1
            segs.append([i, j]); i = j + 1
        else: i += 1
    merged = []
    for s in segs:
        if merged and s[0] - merged[-1][1] <= 3: merged[-1][1] = s[1]
        else: merged.append(s)
    return [s for s in merged if s[1] - s[0] + 1 >= minlen]

def lock_feet(tg, clip, hthr=0.06, vthr=0.35, blend=5):
    """detect foot plants and pin the ankle to its plant position with leg IK; returns contact segments"""
    fps = clip['fps']; res = {}
    for side in 'lr':
        Pw, Qw = world(tg, clip)
        foot = Pw[:, tg.i('foot_' + side)]; ball = Pw[:, tg.i('ball_' + side)]
        y = np.minimum(foot[:, 1] - tg.Pw[tg.i('foot_l'), 1], ball[:, 1] - tg.Pw[tg.i('ball_l'), 1])
        v = np.linalg.norm(np.gradient(ball[:, [0, 2]], axis=0), axis=-1) * fps
        segs = contacts(y, v, hthr, vthr)
        F = len(foot); tgt = foot.copy(); w = np.zeros(F)
        for s0, s1 in segs:
            # pin the ball (toe joint): the ankle may still lift/rotate around it (heel raise in squats)
            pin = ball[s0:s1 + 1].mean(0); pin[1] = max(tg.Pw[tg.i('ball_l'), 1], min(pin[1], ball[s0:s1 + 1, 1].min()))
            tgt[s0:s1 + 1] = foot[s0:s1 + 1] + (pin - ball[s0:s1 + 1]); w[s0:s1 + 1] = 1
            for k in range(1, blend + 1):   # ease in/out
                a = 0.5 + 0.5 * np.cos(np.pi * k / (blend + 1))
                for f in (s0 - k, s1 + k):
                    if 0 <= f < F and w[f] < a: tgt[f] = foot[f] + (pin - ball[f]); w[f] = a
        fwd = qrot(Qw[:, tg.i('pelvis')], np.array([0, 0, 1.0])) * np.array([1, 0, 1.0]) + np.array([0, 0.0, 1e-3])
        two_bone_ik(tg, clip, ('thigh_' + side, 'calf_' + side, 'foot_' + side), tgt, w, pole=fwd)
        res[side] = [[int(a), int(b)] for a, b in segs]
    return res

# ---------------------------------------------------------------- root motion / loops
def extract_root_motion(tg, clip, keep_yaw=False):
    """moves pelvis ground-plane travel (+ yaw) out of the clip into a separate curve [F,(x,z,yaw)].
    The clip becomes in-place: pelvis xz stays over the origin (smoothed), facing stays +Z."""
    Pw, Qw = world(tg, clip)
    ip = tg.i('pelvis')
    pel = Pw[:, ip]
    F = len(pel); k = max(1, int(clip['fps'] * 0.25))
    ker = np.ones(2 * k + 1) / (2 * k + 1)
    pad = lambda x: np.concatenate([np.repeat(x[:1], k), x, np.repeat(x[-1:], k)])
    rx = np.convolve(pad(pel[:, 0]), ker, 'valid'); rz = np.convolve(pad(pel[:, 2]), ker, 'valid')
    yaw = np.unwrap(yaw_of(Qw[:, ip])); yaw = np.convolve(pad(yaw), ker, 'valid')
    if keep_yaw: yaw = yaw * 0
    rm = np.stack([rx - rx[0], rz - rz[0], yaw - yaw[0]], -1)
    # remove from clip: rotate the whole pose about the (moving) root by -yaw, translate by -root
    Yq = qaxis(np.array([[0, 1, 0.0]]).repeat(F, 0), -rm[:, 2])
    newP = qrot(Yq, pel - np.stack([rx, pel[:, 1] * 0, rz], -1)) + np.stack([rx[0] * np.ones(F), pel[:, 1] * 0, rz[0] * np.ones(F)], -1) * 0
    newP[:, 1] = pel[:, 1]
    newQ = qmul(Yq, Qw[:, ip])
    p = tg.sk.parent[ip]
    clip['R'][:, ip] = qmul(qinv(Qw[:, p]), newQ)
    clip['T'][:, ip] = qrot(qinv(Qw[:, p]), newP - Pw[:, p])
    clip['root_motion'] = rm
    return rm

def pose_dist(clip, i, j, idx):
    q1 = clip['R'][i, idx]; q2 = clip['R'][j, idx]
    return np.sum(1 - np.abs(np.sum(q1 * q2, -1)))

def make_loop(tg, clip, search=None):
    """cycle the clip: distributes the end->start pose difference over the whole clip (rotations + pelvis offset).
    Returns the clip trimmed so frame[F-1] ~ frame[0] (three.js LoopRepeat then wraps seamlessly)."""
    F = len(clip['times'])
    R = clip['R']; T = clip['T']
    ip = tg.i('pelvis')
    dq = qmul(R[0], qinv(R[-1]))   # correction at end
    t = np.linspace(0, 1, F)[:, None]
    ident = np.array([0, 0, 0, 1.0])
    for b in range(R.shape[1]):
        corr = qslerp(np.repeat(ident[None], F, 0), np.repeat(dq[b][None], F, 0), t[:, 0])
        R[:, b] = qmul(corr, R[:, b])
    dT = T[0, ip] - T[-1, ip]
    T[:, ip] += t * dT[None]
    return clip

def find_loop(clip, tg, a0, a1, b0, b1):
    """best (start,end) pair: start in [a0,a1], end in [b0,b1] minimising pose distance"""
    idx = [tg.i(n) for n in ('pelvis', 'spine_01', 'spine_03', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'Head')]
    best = None
    for i in range(a0, a1 + 1):
        for j in range(b0, b1 + 1):
            d = pose_dist(clip, i, j, idx)
            if best is None or d < best[0]: best = (d, i, j)
    return best

def trim(clip, f0, f1):
    c = dict(clip); c['T'] = clip['T'][f0:f1 + 1].copy(); c['R'] = clip['R'][f0:f1 + 1].copy()
    c['times'] = clip['times'][f0:f1 + 1] - clip['times'][f0]
    if 'root_motion' in clip: c['root_motion'] = clip['root_motion'][f0:f1 + 1] - clip['root_motion'][f0]
    return c

def mirror(tg, clip):
    """left/right mirror across the X=0 plane (world), swapping _l/_r bones"""
    sk = tg.sk
    Pw, Qw = world(tg, clip)
    F = Pw.shape[0]
    # mirrored world rotation: M R M with M = diag(-1,1,1) -> quat (x,y,z,w) -> (x,-y,-z,w)
    Qm = Qw * np.array([1, -1, -1, 1.0]); Pm = Pw * np.array([-1, 1, 1.0])
    swap = {}
    for i, nm in enumerate(sk.names):
        o = nm[:-2] + ('_r' if nm.endswith('_l') else '_l') if nm.endswith(('_l', '_r')) else nm
        swap[i] = sk.idx.get(o, i)
    # rest-relative: world delta of the mirrored source bone applied to target rest (rest is symmetric)
    newQw = np.zeros_like(Qw)
    for i in range(sk.n):
        j = swap[i]
        # delta from rest for bone j, mirrored, applied to rest of bone i
        Dj = qmul(Qw[:, j], qinv(tg.Qw[j])[None])
        Dm = Dj * np.array([1, -1, -1, 1.0])
        newQw[:, i] = qmul(Dm, tg.Qw[i][None])
    c = dict(clip); c['R'] = clip['R'].copy(); c['T'] = clip['T'].copy()
    for i in sk.order:
        p = sk.parent[i]
        if p >= 0: c['R'][:, i] = qmul(qinv(newQw[:, p]), newQw[:, i])
    ip = tg.i('pelvis'); p = sk.parent[ip]
    c['T'][:, ip] = qrot(qinv(newQw[:, p]), Pm[:, ip] - Pw[:, p] * np.array([-1, 1, 1.0]))
    if 'root_motion' in clip: c['root_motion'] = clip['root_motion'] * np.array([-1, 1, -1.0])
    return c

# ---------------------------------------------------------------- export
def reduce_keys(times, vals, tol, is_quat):
    """greedy linear keyframe reduction: keep key k if linear interp between kept neighbours errs > tol"""
    F = len(times)
    if F <= 2: return np.arange(F)
    keep = [0]; i = 0
    while i < F - 1:
        j = i + 2
        while j < F:
            tt = (times[i + 1:j] - times[i]) / (times[j] - times[i])
            if is_quat:
                interp = qslerp(np.repeat(vals[i][None], len(tt), 0), np.repeat(vals[j][None], len(tt), 0), tt)
                err = np.max(2 * np.arccos(np.clip(np.abs(np.sum(interp * vals[i + 1:j], -1)), 0, 1)))
            else:
                interp = vals[i] + (vals[j] - vals[i]) * tt[:, None]
                err = np.max(np.linalg.norm(interp - vals[i + 1:j], axis=-1))
            if err > tol: break
            j += 1
        i = j - 1; keep.append(i)
    return np.array(sorted(set(keep)))

def clip_tracks(tg, clip, rot_tol=0.0025, pos_tol=0.0008):
    """-> per node {'translation'| 'rotation': (times, values)} with keyframe reduction; every joint gets a rotation
    track and a translation track (constant ones collapse to 2 keys) so crossfades from UAL clips are fully defined."""
    sk = tg.sk; ts = clip['times']; out = {}
    for i in sk.joints:
        R = qcontinuous(clip['R'][:, i]); T = clip['T'][:, i]
        kr = reduce_keys(ts, R, rot_tol, True); kt = reduce_keys(ts, T, pos_tol, False)
        out[i] = {'rotation': (ts[kr], R[kr]), 'translation': (ts[kt], T[kt])}
    return out

def write_clips(path, tg, named_clips, extras=None, dedup=False):
    """named_clips: list of (name, clip, extras_dict). Each track gets its own time accessor (after reduction).
    dedup: identical value arrays (e.g. constant finger rotations shared by many clips) share one accessor."""
    import json, struct
    sk = tg.sk
    nodes = []
    for i in range(sk.n):
        if sk.names[i] == 'Pilot' or (sk.j['nodes'][i].get('mesh') is not None): continue
    keepn = [i for i in range(sk.n) if sk.j['nodes'][i].get('mesh') is None]
    remap = {o: k for k, o in enumerate(keepn)}
    for i in keepn:
        nd = {'name': sk.names[i], 'translation': sk.T[i].tolist(), 'rotation': sk.R[i].tolist()}
        if not np.allclose(sk.S[i], 1): nd['scale'] = sk.S[i].tolist()
        ch = [remap[c] for c in keepn if sk.parent[c] == i]
        if ch: nd['children'] = ch
        nodes.append(nd)
    roots = [remap[i] for i in keepn if sk.parent[i] < 0]
    buf = bytearray(); views = []; accs = []; tcache = {}
    def add(arr, typ, minmax=False):
        arr = np.ascontiguousarray(arr, np.float32)
        key = None
        if typ == 'SCALAR' or dedup:
            key = (typ, arr.tobytes())
            if key in tcache: return tcache[key]
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(arr.tobytes())
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': arr.nbytes})
        a = {'bufferView': len(views) - 1, 'componentType': 5126, 'count': int(arr.shape[0]), 'type': typ}
        if minmax: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
        accs.append(a)
        if key is not None: tcache[key] = len(accs) - 1
        return len(accs) - 1
    anims = []
    for name, clip, ex in named_clips:
        tr = clip_tracks(tg, clip)
        samplers = []; channels = []
        for node, d in tr.items():
            for pth, (tt, vv) in d.items():
                ti = add(np.asarray(tt)[:, None], 'SCALAR', True)
                o = add(vv, 'VEC4' if pth == 'rotation' else 'VEC3')
                samplers.append({'input': ti, 'output': o, 'interpolation': 'LINEAR'})
                channels.append({'sampler': len(samplers) - 1, 'target': {'node': remap[node], 'path': pth}})
        a = {'name': name, 'samplers': samplers, 'channels': channels}
        if ex: a['extras'] = ex
        anims.append(a)
    j = {'asset': {'version': '2.0', 'generator': 'game/tools/anim retarget.py'}, 'scene': 0, 'scenes': [{'nodes': roots}],
         'nodes': nodes, 'animations': anims, 'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}]}
    if extras: j['extras'] = extras
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    while len(buf) % 4: buf.append(0)
    total = 12 + 8 + len(js) + 8 + len(buf)
    open(path, 'wb').write(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(buf), 0x004E4942) + bytes(buf))
    return total

def despike(clip, thr_dps=600, bones=None):
    """replace single-frame rotation spikes (mocap marker swaps / IK flips) by the neighbours' slerp"""
    R = clip['R']; F = len(R); fps = clip['fps']; n = 0
    for b in range(R.shape[1]) if bones is None else bones:
        q = qcontinuous(R[:, b].copy())
        for it in range(3):
            d = 2 * np.degrees(np.arccos(np.clip(np.abs(np.sum(q[1:] * q[:-1], -1)), 0, 1))) * fps
            bad = [f for f in range(1, F - 1) if d[f - 1] > thr_dps and d[f] > thr_dps]
            if not bad: break
            for f in bad: q[f] = qslerp(q[f - 1], q[f + 1], 0.5); n += 1
        R[:, b] = q
    return n
