"""Palm-on-surface fix for the hand contact clips (ARCH-INTERACT.md, Body/Motion: palm measured on the drawn glove).
usage: <Blender python> build_palm_fix.py <workdir>       (env PALM_ONLY=hand_wall_l,... restricts the families; PALM_FAST=1 = coarse search)
  workdir: pilot_aces_textured.glb, out/anim_pilot_contact.glb + out/anim_pilot_contact.meta.json (the wave-2 library)
writes <workdir>/out_palm/anim_pilot_contact.glb + .meta.json: the clips below re-posed, every other clip's accessors unchanged.

What the model does (measured, tools/anim/skin.py + miniview.py renders):
  * the glove is ONE rigid piece skinned to the FOREARM (lowerarm_*); the hand bone has ~0 weight, so the wrist cannot bend.
    Wrist "extension" therefore = the whole forearm's angle. Fingers are flat and lie in the palm plane.
  * the thumb (skinned 100 % to the forearm at its tip) sticks 6-7 cm out of the palm plane towards the palm normal. A palm laid
    flat on a wall puts the thumb 6-7 cm into it, and the old clips laid the fingertips on the wall instead (glove 6-7 cm inside).
Now, per contact window: the forearm is oriented so the palm faces the surface (fingers up / slightly outward on walls, along the
top on ledges), rolled / pitched by a small fixed tilt (per hand, <= TILT deg) so the thumb clears the surface, and the palm CENTRE
lies within ~1-2 cm of it. The elbow is solved on the upper-arm sphere with the shoulder fixed and chosen for a natural arm (elbow
flexion, elbow down/out, forearm twist in range, away from the torso and the helmet). Where the shoulder is too far from the surface
for a rigid forearm-along-the-surface (ledge / dome / slope), the whole body is leaned toward it and, if needed, the surface is moved
along its normal (the clip's surface point / approach / heightRange move with it).
Everything is verified on the SKINNED glove + arm (max penetration of any vertex, palm-centre gap, palm-normal angle), before and after.
Meta: surface.point = palm centre projected on the surface; contact.palm = {inHand, normalHand, wrist, gap, tilt, penetration ...}.
"""
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retarget as RT
from retarget import *
from loadlib import load_clip
from skin import Skin

W = sys.argv[1]
SRC = W + '/out/anim_pilot_contact.glb'; META = json.load(open(W + '/out/anim_pilot_contact.meta.json'))
OUT = W + '/out_palm'; os.makedirs(OUT, exist_ok=True)
tg = Target(W + '/pilot_aces_textured.glb'); SK = Skin(tg, W + '/pilot_aces_textured.glb')
FPS = 30.0; DEG = np.pi / 180
FAST = bool(os.environ.get('PALM_FAST'))
TILT = float(os.environ.get('PALM_TILT', 20))          # max palm-normal deviation from -surface normal (deg): the thumb tip (rigid, 6.7 cm out of the palm plane) needs it
TARGETS = ['hand_wall_r_in', 'hand_wall_r_loop', 'hand_wall_r_in_walk', 'hand_wall_l_in', 'hand_wall_l_loop', 'hand_wall_l_in_walk',
           'hand_wall_both_in', 'hand_wall_both_loop', 'hand_wall_both_in_walk', 'lean_hands_ledge_loop',
           'brace_slope_r_in', 'brace_slope_r_loop', 'brace_slope_l_in', 'brace_slope_l_loop',
           'lean_dome_r_in', 'lean_dome_r_loop', 'lean_dome_l_in', 'lean_dome_l_loop']
ONLY = [x for x in os.environ.get('PALM_ONLY', '').split(',') if x]
if ONLY: TARGETS = [n for n in TARGETS if any(n.startswith(o) for o in ONLY)]
GLOVE_PRIMS = (0, 13)          # lambert4S.002 + lambert3S.002 = the black glove (hand + fingers + thumb)
ARM_PRIMS = (0, 2, 9, 10, 13)  # glove, cuff ring, sleeve pieces near the wrist

def nz(v): return v / np.linalg.norm(v)
def rotm(axis, a):
    axis = nz(np.asarray(axis, float)); K = np.array([[0, -axis[2], axis[1]], [axis[2], 0, -axis[0]], [-axis[1], axis[0], 0]])
    return np.eye(3) + np.sin(a) * K + (1 - np.cos(a)) * K @ K
def rot_about(v, axis, a):
    axis = nz(axis); return v * np.cos(a) + np.cross(axis, v) * np.sin(a) + axis * axis.dot(v) * (1 - np.cos(a))
def basis(a, b):
    a = nz(a); b = nz(b - a * a.dot(b)); return np.stack([a, b, np.cross(a, b)], 1)

# ------------------------------------------------------------------ the mitten in the forearm frame (bind pose)
sk = tg.sk
POSE0 = dict(T=sk.T[None].copy(), R=sk.R[None].copy())      # bind, fingers as in the clips (flat), thumb as in the idle
for s in 'lr':
    for n in ('thumb_01_', 'thumb_02_', 'thumb_03_'):
        POSE0['R'][0, tg.i(n + s)] = tg.idle[1][0, tg.i(n + s)]
V0 = SK.verts(POSE0, 0)
GLOVE = {}
for s, sg in (('r', -1), ('l', 1)):
    hp = tg.Pw[tg.i('hand_' + s)]; ilo = tg.i('lowerarm_' + s)
    side = ((V0[:, 0] < 0) == (s == 'r')) & (np.abs(V0[:, 0]) > 0.45) & (np.linalg.norm(V0 - hp, axis=1) < 0.32)
    Lm = q_to_mat(tg.Qw[ilo][None])[0]; Plo = tg.Pw[ilo]
    Vl = (V0 - Plo) @ Lm                                                     # forearm-local (bind), origin = elbow
    m = (np.linalg.norm(SK.P - hp, axis=1) < 0.16) & (SK.P[:, 0] * sg > abs(hp[0]) - 0.03) & \
        np.isin(SK.top, ['lowerarm_' + s, 'hand_' + s, 'thumb_01_' + s, 'thumb_02_' + s, 'thumb_03_' + s])
    V = (SK.P[m] - Plo) @ Lm
    npal = nz(Lm.T @ np.array([0, -1.0, 0]))                                 # palm faces down at bind (hand local -X right / +X left)
    Cg = V - V.mean(0); _, _, Vt = np.linalg.svd(Cg - np.outer(Cg @ npal, npal), full_matrices=False)
    fing = nz(Vt[0] - npal * Vt[0].dot(npal))                                # the mitten's long axis in the palm plane
    if (V @ fing).mean() < (tg.sk.T[tg.i('hand_' + s)] @ fing): fing = -fing
    d = V @ npal; face = V[d > d.max() - 0.012]; c = face.mean(0); c = c + npal * (d.max() - c.dot(npal))
    fore = np.isin(SK.top, ['lowerarm_' + s, 'hand_' + s, 'thumb_01_' + s, 'thumb_02_' + s, 'thumb_03_' + s])
    hand_in_lo = tg.sk.T[tg.i('hand_' + s)]
    Hm = q_to_mat(tg.Qw[tg.i('hand_' + s)][None])[0]
    G = dict(side=side, fore=fore, n=npal, f=fing, c=c, hand=hand_in_lo, Hrel=tg.sk.R[tg.i('hand_' + s)].copy(),
             lo_axis=nz(tg.sk.T[tg.i('hand_' + s)]), Lup=float(np.linalg.norm(tg.sk.T[ilo])), sg=sg)
    G['inHand'] = ((Lm @ c + Plo) - hp) @ Hm; G['nHand'] = Hm.T @ (Lm @ npal)
    # hull used for the tilt search: glove + cuff/sleeve near the wrist, no spikes (stretched thumb vertex)
    hull = side & np.isin(SK.prim, ARM_PRIMS) & (Vl @ npal < 0.22)
    G['hull'] = Vl[hull]; G['glove_idx'] = np.where(side & np.isin(SK.prim, GLOVE_PRIMS) & (Vl @ npal < 0.22))[0]
    GLOVE[s] = G
    print('glove %s: palm centre %.3f m from the wrist (hand frame %s), palm normal (hand) %s, hull %d verts' % (s, np.linalg.norm(G['inHand']), G['inHand'].round(3), G['nHand'].round(2), hull.sum()))

# thumb tuck: the thumb bones (only their own weighted vertices follow them) laid toward the palm plane, once per hand
def rv2q(v):
    a = np.linalg.norm(v); return np.array([0, 0, 0, 1.0]) if a < 1e-9 else np.concatenate([v / a * np.sin(a / 2), [np.cos(a / 2)]])
def thumb_ids(s): return [tg.i(n + s) for n in ('thumb_01_', 'thumb_02_', 'thumb_03_')]
TUCK = {}
_cache = W + '/thumb_tuck2.json'; _tc = json.load(open(_cache)) if os.path.exists(_cache) else {}
for s in 'lr':
    G = GLOVE[s]; ilo = tg.i('lowerarm_' + s); Lm = q_to_mat(tg.Qw[ilo][None])[0]; Plo = tg.Pw[ilo]; ids = thumb_ids(s)
    if s in _tc: TUCK[s] = np.array(_tc[s]); continue
    tn = ['thumb_01_' + s, 'thumb_02_' + s, 'thumb_03_' + s, 'thumb_04_leaf_' + s]
    wt = np.zeros(len(SK.P))
    for k in range(4): wt += SK.W[:, k] * np.isin([sk.names[SK.joints[j]] for j in SK.J[:, k]], tn)
    sel = (wt > 0.05) & G['side']; dp = float(G['c'] @ G['n']); rng = np.random.default_rng(1)
    # edges of the thumb region: a tuck that stretches them (a "blade" thumb) is refused
    selidx = np.where(sel)[0]; loc = -np.ones(len(SK.P), int); loc[selidx] = np.arange(len(selidx))
    Fs = SK.F[np.all(sel[SK.F], 1)]; E_ = np.concatenate([Fs[:, [0, 1]], Fs[:, [1, 2]], Fs[:, [2, 0]]]); E_ = loc[E_]
    Vrest = SK.verts(POSE0, 0, sel); L0 = np.linalg.norm(Vrest[E_[:, 0]] - Vrest[E_[:, 1]], axis=1) + 1e-4
    def cost(rv):
        cl = dict(T=POSE0['T'], R=POSE0['R'].copy())
        for k, i in enumerate(ids): cl['R'][0, i] = qmul(rv2q(rv[3 * k:3 * k + 3]), POSE0['R'][0, i])
        Vp = SK.verts(cl, 0, sel); d = ((Vp - Plo) @ Lm) @ G['n']
        st = np.linalg.norm(Vp[E_[:, 0]] - Vp[E_[:, 1]], axis=1) / L0
        return (np.maximum(0, d - (dp - 0.003)) ** 2).sum() * 40 + (np.maximum(0, (dp - 0.04) - d) ** 2).sum() * 10 + 0.05 * (rv ** 2).sum() + (np.maximum(0, st - 1.35) ** 2).sum() * 4
    x = np.zeros(9); j = cost(x); sig = 0.3
    for it in range(3000):
        y = x + rng.normal(0, sig, 9) * (rng.random(9) < 0.4); jy = cost(y)
        if jy < j: x, j = y, jy
        if it % 750 == 749: sig *= 0.5
    TUCK[s] = x; _tc[s] = x.tolist(); print('  thumb tuck %s: cost %.3f -> %.3f' % (s, cost(np.zeros(9)), j))
json.dump(_tc, open(_cache, 'w'))
for s in 'lr':
    for k, i in enumerate(thumb_ids(s)): POSE0['R'][0, i] = qmul(rv2q(TUCK[s][3 * k:3 * k + 3]), POSE0['R'][0, i])
V0 = SK.verts(POSE0, 0)
for s in 'lr':      # the hull with the tucked thumb
    G = GLOVE[s]; ilo = tg.i('lowerarm_' + s); Lm = q_to_mat(tg.Qw[ilo][None])[0]; Vl = (V0 - tg.Pw[ilo]) @ Lm
    hull = G['side'] & np.isin(SK.prim, ARM_PRIMS) & (Vl @ G['n'] < 0.22)
    G['hull'] = Vl[hull]; G['glove_idx'] = np.where(G['side'] & np.isin(SK.prim, GLOVE_PRIMS) & (Vl @ G['n'] < 0.22))[0]
    G['thumbQ'] = [qmul(rv2q(TUCK[s][3 * k:3 * k + 3]), tg.idle[1][0, i]) for k, i in enumerate(thumb_ids(s))]

# tilt of the mitten (roll about the fingers, pitch about the palm's cross axis) that lets the rigid thumb / cuff clear the plane.
# The last ~16 vertices of the thumb tip (skinned 100 % to the forearm, they cannot be tucked) may sit up to TIP_IN cm inside the
# surface: without that the palm centre would hover 3-5 cm off it. Every other vertex of the glove and arm stays out (<= 4 mm).
TIP_K, TIP_IN = int(os.environ.get('PALM_TIPK', 30)), float(os.environ.get('PALM_TIPIN', 0.05))
for s in 'lr':
    G = GLOVE[s]; n, f, c = G['n'], G['f'], G['c']; e = np.cross(n, f); best = None
    for gd in np.arange(-45, 46, 3):
        for bd in np.arange(-30, 46, 3):
            Rt = rotm(f, gd * DEG) @ rotm(e, bd * DEG); w = Rt @ n
            tilt = np.degrees(np.arccos(np.clip(w @ n, -1, 1)))
            if tilt > TILT: continue
            pr = G['hull'] @ w; sup = max(np.sort(pr)[-TIP_K - 1], pr.max() - TIP_IN)
            gap = sup - c @ w                                               # palm centre gap when the plane rests on the hull
            cost = gap + 0.0003 * tilt
            if best is None or cost < best[0]: best = (cost, gd, bd, tilt, gap, Rt, w)
    G['Rt'] = best[5]; G['tilt'] = best[3]; G['gap0'] = best[4]
    # the tip vertices (global ids) at that tilt: judged with the looser tolerance
    Vl_ = G['hull']; pr = Vl_ @ best[6]; tipset = np.argsort(pr)[-TIP_K:]
    hull_ids = np.where(G['side'] & np.isin(SK.prim, ARM_PRIMS) & (((V0 - tg.Pw[tg.i('lowerarm_' + s)]) @ q_to_mat(tg.Qw[tg.i('lowerarm_' + s)][None])[0]) @ n < 0.22))[0]
    G['tip'] = set(hull_ids[tipset].tolist())
    print('  tilt %s: roll %+.0f pitch %+.0f -> palm-normal deviation %.0f deg, palm centre %.1f cm off the plane (flat: %.1f cm, worst-16 vertices ignored)' %
          (s, best[1], best[2], best[3], best[4] * 100, ((G['hull'] @ n).max() - c @ n) * 100))

def glove_vs_plane(clip, f, s, P0, N, tips=False):
    """(min signed distance of any glove vertex / of any arm vertex to the surface; positive = clear, negative = inside), the
    tolerated thumb-tip vertices apart; tips=True: their own minimum"""
    Vg = SK.verts(clip, f); G = GLOVE[s]
    if tips:
        ti = np.array(sorted(G['tip'])); return float(((Vg[ti] - P0) @ N).min())
    keep = np.array([i not in G['tip'] for i in G['glove_idx']])
    gl = Vg[G['glove_idx'][keep]]; am = ARMS[s].copy(); am[list(G['tip'])] = False; arm = Vg[am]
    return float(((gl - P0) @ N).min()), float(((arm - P0) @ N).min())
ARMS = {s: np.isin(SK.top, ['upperarm_' + s, 'lowerarm_' + s, 'hand_' + s, 'thumb_01_' + s, 'thumb_02_' + s, 'thumb_03_' + s]) for s in 'lr'}
def body_vs_plane(clip, f, P0, N, sides):
    m = ~np.any([ARMS[s] for s in sides], 0); V = SK.verts(clip, f, m)
    if abs(N[1]) < 0.5: V = V[V[:, 1] > 0.6]                 # a face: boots / shins may stand under a receding base
    elif abs(N[1]) > 0.9: return 9.0                        # a top: the body is behind the ledge, its front edge is not modelled
    else: V = V[V[:, 1] > 1.0]                              # slope / dome: chest and head
    return float(((V - P0) @ N).min())
def palm_world(clip, f, s):
    """palm centre + palm normal of the drawn glove in the clip's frame f"""
    Pw, Qw = world(tg, clip); il = tg.i('lowerarm_' + s); Lw = q_to_mat(Qw[f, il][None])[0]; G = GLOVE[s]
    return Pw[f, il] + Lw @ G['c'], Lw @ (G['Rt'] @ G['n'])
def palm_metrics(clip, f, s, P0, N):
    pc, pn = palm_world(clip, f, s); pen_g, pen_a = glove_vs_plane(clip, f, s, P0, N); pen_t = glove_vs_plane(clip, f, s, P0, N, tips=True)
    ang = float(np.degrees(np.arccos(np.clip(pn @ -N, -1, 1))))
    # angle of the ideal (flat) palm normal to -N too
    Pw, Qw = world(tg, clip); Lw = q_to_mat(Qw[f, tg.i('lowerarm_' + s)][None])[0]
    flat = float(np.degrees(np.arccos(np.clip((Lw @ GLOVE[s]['n']) @ -N, -1, 1))))
    return dict(gap=float((pc - P0) @ N), glove=pen_g, arm=pen_a, tip=pen_t, tilt=ang, flat=flat, pc=pc)

def pref_fingers(s, N):
    sg = GLOVE[s]['sg']
    up = np.array([0, 1.0, 0]) if abs(N[1]) < 0.5 else np.array([0, 0.3, 1.0])
    d = nz(up - N * up.dot(N)); out = nz(np.cross(N, d)) * (1 if np.cross(N, d)[0] * sg > 0 else -1)
    return nz(d * np.cos(15 * DEG) + out * np.sin(15 * DEG))           # fingers up (along the top: forward), splayed ~15 deg outward

def mitten_R(s, N, th):
    """forearm world rotation: the (tilted) palm faces -N, fingers along the preferred direction spun by th about N"""
    G = GLOVE[s]; d = rot_about(pref_fingers(s, N), N, th); Rt = G['Rt']
    return basis(-N, d) @ basis(Rt @ G['n'], Rt @ G['f']).T

def circle(S, s, R, P0, N, gap, hard=True):
    """elbow on the upper-arm sphere (centre S, radius Lup), palm centre on the plane (P0 + N*gap): -> (centre Qp, radius r) of the
    circle the palm centre may move on inside that plane"""
    G = GLOVE[s]; Q = S + R @ G['c']; h = (Q - P0) @ N - gap
    if abs(h) >= G['Lup']: return (Q - N * h, 0.0) if hard is False else None   # out of reach: the palm lands as near as the arm allows
    return Q - N * h, np.sqrt(G['Lup'] ** 2 - h * h)

def solve(S, s, P0, N, W0, th, gap, hard=True):
    """shoulder S, surface (P0, N), wanted palm point W0, finger spin th -> (R forearm, E elbow, W palm centre) | None"""
    G = GLOVE[s]; R = mitten_R(s, N, th); cr = circle(S, s, R, P0, N, gap, hard)
    if cr is None: return None
    Qp, r = cr; w = W0 - N * ((W0 - P0) @ N) - Qp
    Wp = Qp + (nz(w) if np.linalg.norm(w) > 1e-6 else nz(np.cross(N, [1, 0, 0]))) * r
    return R, Wp - R @ G['c'], Wp

def twist_y(q): return np.degrees(2 * np.arctan2(q[1], q[3]))
def wrap(a): return (a + 180) % 360 - 180

def score(S, s, R, E, Wp, W0, torso):
    """0 = a natural arm; larger = worse"""
    G = GLOVE[s]; sg = G['sg']; u = E - S; v = R @ G['lo_axis']; pen = 0.0
    flex = np.degrees(np.arccos(np.clip(nz(u) @ v, -1, 1)))
    if flex < 30: pen += (30 - flex) / 30
    if flex > 135: pen += (flex - 135) / 30
    # forearm twist relative to the upper arm (swing from the bind direction, no twist), sign-normalised for the side
    Qu = qmul(qbetween(np.array([sg, 0, 0.0]), nz(u)), tg.Qw[tg.i('upperarm_' + s)])
    Ql = mat_to_q(R[None])[0]; tw = wrap(twist_y(qmul(qinv(Qu), Ql))) * sg
    if tw < -115: pen += (-115 - tw) / 40
    if tw > 30: pen += (tw - 30) / 40
    line = nz(Wp - S); e = u - line * (u @ line); el = np.linalg.norm(e)
    if el > 0.02:
        if e[1] / el > 0.4: pen += (e[1] / el - 0.4) * 2                 # elbow pointing up
        if e[0] * sg / el < -0.4: pen += (-e[0] * sg / el - 0.4) * 2      # elbow into the body
    # elbow / forearm middle vs the torso axis and the helmet
    a0, a1, hs = torso
    def segd(p):
        t = np.clip((p - a0) @ (a1 - a0) / ((a1 - a0) @ (a1 - a0)), 0, 1); return np.linalg.norm(p - (a0 + (a1 - a0) * t))
    if segd(E) < 0.15: pen += (0.15 - segd(E)) * 8
    mid = (E + Wp) / 2
    if segd(mid) < 0.13: pen += (0.13 - segd(mid)) * 8
    if np.linalg.norm(mid - hs) < 0.24: pen += (0.24 - np.linalg.norm(mid - hs)) * 6
    if np.linalg.norm(Wp - hs) < 0.26: pen += (0.26 - np.linalg.norm(Wp - hs)) * 6
    return np.linalg.norm(Wp - W0) * 0.6 + pen, dict(flex=flex, tw=tw)

def best_for(S, s, P0, N, W0, gap, torso, tol, exact=False):
    """sweep finger spin and the elbow circle: the natural arm whose palm centre is closest to W0 (exact: the palm point W0 itself,
    the elbow follows from the finger spin)"""
    best = None
    for th in np.arange(-80, 81, 1 if exact else (10 if FAST else 5)) * DEG:
        R = mitten_R(s, N, th); cr = circle(S, s, R, P0, N, gap)
        if cr is None: continue
        if exact:
            sl = solve(S, s, P0, N, W0, th, gap)
            dl = sl[2] - W0
            if np.linalg.norm(dl) > tol[0]: continue
            sc, info = score(S, s, sl[0], sl[1], sl[2], W0, torso); sc += abs(th) / DEG * 0.003
            if best is None or sc < best[0]: best = (sc, th, info, sl)
            continue
        Qp, r = cr; a1 = nz(np.cross(N, [1, 0, 0]) if abs(N[0]) < 0.9 else np.cross(N, [0, 1, 0])); a2 = np.cross(N, a1)
        for ph in np.arange(0, 360, 20 if FAST else 10) * DEG:
            Wp = Qp + (a1 * np.cos(ph) + a2 * np.sin(ph)) * r; E = Wp - R @ GLOVE[s]['c']
            dl = Wp - W0; dt = dl - N * (dl @ N); lat = abs(dt[0]); oth = np.sqrt(max(0.0, dt @ dt - dt[0] ** 2))
            if lat > tol[0] or oth > tol[1]: continue           # the palm may slide over the face only this far from the authored spot
            sc, info = score(S, s, R, E, Wp, W0, torso); sc += abs(th) / DEG * 0.003
            if best is None or sc < best[0]: best = (sc, th, info, (R, E, Wp))
    return best

def apply(clip, f, s, R, E, w):
    """upper arm swung to the elbow E, forearm world rotation R, hand at its rest angle; blended by w into the clip's own pose"""
    iu, il, ih = tg.i('upperarm_' + s), tg.i('lowerarm_' + s), tg.i('hand_' + s)
    R0 = clip['R'][f].copy()
    Pw, Qw = tg.sk.fk(clip['T'][f][None], clip['R'][f][None]); Pw, Qw = Pw[0], Qw[0]
    cur = Pw[il] - Pw[iu]; q = qbetween(nz(cur), nz(E - Pw[iu]))
    Qu = qmul(q, Qw[iu]); pu = tg.sk.parent[iu]
    clip['R'][f, iu] = qmul(qinv(Qw[pu]), Qu)
    Ql = mat_to_q(R[None])[0]
    clip['R'][f, il] = qmul(qinv(Qu), Ql)
    clip['R'][f, ih] = GLOVE[s]['Hrel']
    for k, i in enumerate(thumb_ids(s)): clip['R'][f, i] = GLOVE[s]['thumbQ'][k]
    for i in (iu, il, ih, *thumb_ids(s)):
        clip['R'][f, i] = qslerp(R0[i][None], clip['R'][f, i][None], np.array([w]))[0]

def weights(c, ts, bi_min=0.0):
    w0, w1 = c['window']; bi, bo = max(c.get('blendIn', 0.15), min(bi_min, w0 - 0.02)), c.get('blendOut', 0.2)
    w = np.zeros(len(ts))
    for k, t in enumerate(ts):
        if w0 <= t <= w1: w[k] = 1
        elif w0 - bi < t < w0: u = (t - (w0 - bi)) / bi; w[k] = u * u * (3 - 2 * u)
        elif w1 < t < w1 + bo: u = 1 - (t - w1) / bo; w[k] = u * u * (3 - 2 * u)
    return w

from author import rotate_world
def twist(clip, gamma, wk):
    """upper body turned about the vertical by gamma*wk[k] at spine_01 (brings one shoulder toward the surface)"""
    F = len(clip['times']); rotate_world(tg, clip, 'spine_01', qaxis(np.repeat([[0, 1.0, 0]], F, 0), gamma * np.asarray(wk)))
    rotate_world(tg, clip, 'Head', qaxis(np.repeat([[0, 1.0, 0]], F, 0), -0.5 * gamma * np.asarray(wk)))

def lean(clip, beta, N, wk):
    """whole body inclined toward the surface by beta*wk[k] (rad) about the ankles, feet kept where they were (leg IK);
    the head counter-rotates 60 % so the gaze stays on the contact"""
    fh = -N * np.array([1, 0, 1.0]); fh = nz(fh) if np.linalg.norm(fh) > 0.3 else np.array([0, 0, 1.0])
    ax = nz(np.cross([0, 1.0, 0], fh))
    Pw, Qw = world(tg, clip); F = len(clip['times'])
    feet = {sd: Pw[:, tg.i('foot_' + sd)].copy() for sd in 'lr'}
    A = (feet['l'] + feet['r']) / 2; A[:, 1] = 0
    b = beta * np.asarray(wk)
    q = qaxis(np.repeat(ax[None], F, 0), b)
    pel = A + qrot(q, Pw[:, tg.i('pelvis')] - A)
    set_world_pelvis(tg, clip, pel)
    rotate_world(tg, clip, 'pelvis', q)
    rotate_world(tg, clip, 'Head', qaxis(np.repeat(ax[None], F, 0), -0.6 * b))
    for sd in 'lr':
        Pw2, Qw2 = world(tg, clip)
        fwd = qrot(Qw2[:, tg.i('pelvis')], np.array([0, 0, 1.0])) * np.array([1, 0, 1.0]) + np.array([0, 0.25, 1e-3])
        two_bone_ik(tg, clip, ('thigh_' + sd, 'calf_' + sd, 'foot_' + sd), feet[sd], None, pole=fwd)

def hinge(clip, beta, N, wk):
    """upper body folded forward at the waist by beta*wk[k] (rad) toward the surface (pelvis and feet stay), head counter-rotates 60 %"""
    fh = -N * np.array([1, 0, 1.0]); fh = nz(fh) if np.linalg.norm(fh) > 0.3 else np.array([0, 0, 1.0])
    ax = nz(np.cross([0, 1.0, 0], fh)); F = len(clip['times']); b = beta * np.asarray(wk)
    rotate_world(tg, clip, 'spine_01', qaxis(np.repeat(ax[None], F, 0), b))
    rotate_world(tg, clip, 'Head', qaxis(np.repeat(ax[None], F, 0), -0.6 * b))

def body_move(clip, mode, beta, N, wk):
    if beta: (lean if mode == 'lean' else hinge)(clip, beta, N, wk)

def torso_of(Pw, k):
    return Pw[k, tg.i('pelvis')].copy(), Pw[k, tg.i('neck_01')].copy(), Pw[k, tg.i('Head')] + np.array([0, 0.06, 0.0])

# ------------------------------------------------------------------ re-pose
# Per family (wall / ledge / slope / dome, shared by _in, _loop, _in_walk) the body lean, the shoulder turn, the surface offset,
# the finger spin and the palm point are searched once at the middle of the full-contact window; every frame then re-solves the
# arm with the same spin and palm point (the shoulder breathes, the palm stays).
FAM = {}
def family(n):
    for suf in ('_in_walk', '_in', '_loop'):
        if n.endswith(suf): return n[:-len(suf)]
    return n
def hand_contacts(m): return [c for c in m['contacts'] if c['bone'].startswith('hand_')]
order = sorted(TARGETS, key=lambda n: 0 if n.endswith('_loop') else 1)
NEWC = {}; REPORT = []
for name in order:
    m = META['clips'][name]; clip = load_clip(tg, SRC, name, FPS); ts = clip['times']; fam = family(name)
    HC = hand_contacts(m); sides = [c['bone'][-1] for c in HC]
    orig = {k: (v.copy() if hasattr(v, 'copy') else v) for k, v in clip.items()}
    Pw, _ = world(tg, clip)
    # the arm is brought to the surface over a longer ramp than the clip's own blend (the rebuilt arm pose differs a lot from the authored one)
    Wt = {c['bone'][-1]: weights(c, ts, 0.36 if name.endswith('_in') else 0.2 if name.endswith('_in_walk') else 0.0) for c in HC}
    fs_all = sorted({k for s in sides for k in range(len(ts)) if Wt[s][k] > 0})
    full = [k for k in fs_all if all(Wt[s][k] >= 1 for s in sides)] or fs_all[-1:]
    # the family is solved at the frame where the shoulders are farthest from the surface (the hardest reach); every other frame is nearer
    _N = nz(np.array(HC[0]['surface']['normal'], float)); _P = np.array(HC[0]['surface']['point'], float)
    fm = max(full, key=lambda k: max(float((Pw[k, tg.i('upperarm_' + sd)] - _P) @ _N) for sd in sides))
    N = nz(np.array(HC[0]['surface']['normal'], float)); wall = abs(N[1]) < 0.5
    before = {}
    for c in HC:
        s = c['bone'][-1]; P0 = np.array(c['surface']['point'], float); before[s] = palm_metrics(clip, fm, s, P0, N)
    wmax = np.max([Wt[sd] for sd in sides], 0)
    if fam not in FAM:
        gsign = (1 if sides == ['r'] else -1 if sides == ['l'] else 0); pick = None; fallback = None
        if wall: offs = np.arange(0, 0.21, 0.04); leans = (0, 4, 8, 12, 16, 20, 26)
        elif abs(N[1]) > 0.9: offs = np.arange(-0.06, 0.62, 0.04); leans = (0, 8, 16, 24, 32, 40)
        else: offs = np.arange(-0.06, 0.5, 0.04); leans = (0, 8, 16, 24, 32)
        modes = ('lean', 'hinge') if abs(N[1]) > 0.9 else ('lean',)
        if len(sides) == 2:      # two hands: square the shoulders to the surface first (the authored torso is yawed), a few degrees either way
            dS = Pw[fm, tg.i('upperarm_l')] - Pw[fm, tg.i('upperarm_r')]; g0 = float(np.round(np.degrees(np.arctan2(dS[2], dS[0])) / 2) * 2)
            if abs(N[2]) < 0.5: g0 = 0.0        # a top / slope seen from the side: the yaw is about the surface's own normal, keep the authored torso
            gvals = tuple(sorted({g0, g0 - 8, g0 + 8, 0.0}, key=abs))
        else: gvals = (0, 12) if gsign else (0,)
        tries = sorted([(b, o, g, md) for md in modes for b in leans for o in offs for g in gvals],
                       key=lambda t: t[0] * 0.01 + abs(t[1]) + t[2] * 0.004)
        for bdeg, off, gdeg, mode in tries:
            test = {k: (v.copy() if hasattr(v, 'copy') else v) for k, v in orig.items()}
            one = np.zeros(len(ts)); one[fm] = 1
            if gdeg: twist(test, (gsign or 1) * gdeg * DEG, one)
            body_move(test, mode, bdeg * DEG, N, one)
            Pt, _ = world(tg, test); sol = {}; tors = torso_of(Pt, fm)
            for c in sorted(HC, key=lambda c: c['bone']):
                sd = c['bone'][-1]; P0 = np.array(c['surface']['point'], float) + N * off; W0 = P0; mirrored = False; tl = (0.22, 0.35) if wall else ((0.2, 0.4) if abs(N[1]) > 0.9 else (0.16, 0.35))
                if 'l' in sol and sd == 'r':      # two hands: the second palm mirrors the first (hands symmetric about the body's midline)
                    W0 = sol['l'][1] * np.array([-1, 1, 1.0]); tl = (0.03,)
                # the pose keeps the authored palm point (moved with the surface) within a box: the palm centre may slide over the
                # face so the arm is natural
                bst = best_for(Pt[fm, tg.i('upperarm_' + sd)], sd, P0, N, W0, GLOVE[sd]['gap0'], tors, tl, exact=(W0 is not P0))
                mirrored = W0 is not P0
                if bst is None and W0 is not P0: mirrored = False; bst = best_for(Pt[fm, tg.i('upperarm_' + sd)], sd, P0, N, P0, GLOVE[sd]['gap0'], tors, (0.22, 0.35) if wall else (0.2, 0.4))
                if bst is None or bst[0] > 0.6 or not (30 < bst[2]['flex'] < 140): sol = None; break
                sol[sd] = (bst[1], bst[3][2], bst[2], bst[0] + 0.0, mirrored)
            if os.environ.get('PALM_DEBUG'): print('   try', fam, mode, bdeg, round(off, 2), gdeg, 'sol', None if not sol else {k: (round(v[3], 2), round(v[2]['flex']), v[4]) for k, v in sol.items()})
            if not sol: continue
            for c in HC:
                sd = c['bone'][-1]; P0 = np.array(c['surface']['point'], float) + N * off
                r = solve(Pt[fm, tg.i('upperarm_' + sd)], sd, P0, N, sol[sd][1], sol[sd][0], GLOVE[sd]['gap0']); apply(test, fm, sd, r[0], r[1], 1.0)
            if body_vs_plane(test, fm, np.array(HC[0]['surface']['point'], float) + N * off, N, sides) < 0.02: continue
            tot = max(sol[sd][3] for sd in sol)
            if len(sol) == 2 and not sol['r'][4]: tot += 0.5       # asymmetric pair: only as a fallback
            cand = (off, sol, bdeg, (gsign or 1) * gdeg, mode)
            if tot <= 0.22: pick = cand; break                      # a natural arm at this lean / surface move
            if fallback is None or tot + 0.004 * bdeg + 0.5 * abs(off) < fallback[0]: fallback = (tot + 0.004 * bdeg + 0.5 * abs(off), cand)
        if pick is None and fallback is not None: pick = fallback[1]
        if pick is None:
            print('  !! %s: no natural pose found (kept as it was)' % fam); FAM[fam] = None
        else:
            FAM[fam] = {'off': pick[0], 'lean': pick[2] * DEG, 'mode': pick[4], 'twist': pick[3] * DEG, **{sd: pick[1][sd][:2] for sd in pick[1]}}
            for sd in pick[1]:
                ch = pick[1][sd][2]; print('  %-16s %s: body %s %2d deg, turn %+3d deg, surface moved %+.2f m, palm at %s, fingers spin %+.0f, elbow flex %.0f, twist %.0f, cost %.2f' % (fam, sd, pick[4], pick[2], pick[3], pick[0], pick[1][sd][1].round(2), np.degrees(pick[1][sd][0]), ch['flex'], ch['tw'], pick[1][sd][3]))
    if FAM[fam] is None:
        NEWC[name] = clip; continue
    if FAM[fam]['twist']: twist(clip, FAM[fam]['twist'], wmax)
    body_move(clip, FAM[fam]['mode'], FAM[fam]['lean'], N, wmax)
    Pw, _ = world(tg, clip)
    off = FAM[fam]['off']
    for c in HC:
        s = c['bone'][-1]; P0 = np.array(c['surface']['point'], float) + N * off; th, Wb = FAM[fam][s]; gap = GLOVE[s]['gap0']
        def run_frames(P0_, Wb_, gap_):
            # per frame the finger spin is re-tuned (+-50 deg around the family's) so the elbow circle passes through the planted palm point:
            # the shoulder sways with the breathing / the authored body motion, the palm stays where it is
            prev = th
            for k in range(len(ts)):
                if Wt[s][k] <= 0: continue
                S_ = Pw[k, tg.i('upperarm_' + s)]; bestk = None
                for dth in np.arange(-50, 50.5, 1.0) * DEG:
                    r = solve(S_, s, P0_, N, Wb_, th + dth, gap_, hard=False)
                    if r is None: continue
                    e = np.linalg.norm(r[2] - Wb_) + 0.0004 * abs(th + dth - prev) / DEG
                    if bestk is None or e < bestk[0]: bestk = (e, th + dth, r)
                if bestk is not None:
                    prev = bestk[1]; r = bestk[2]; apply(clip, k, s, r[0], r[1], Wt[s][k])
        run_frames(P0, Wb, gap)
        # no vertex of the drawn glove / cuff / sleeve may dip more than 4 mm into the surface anywhere in the window:
        # move the palm plane out (the palm centre gap grows) until it holds
        for it in range(6):
            fr = [k for k in range(len(ts)) if Wt[s][k] >= 0.99] or [fm]
            worst = min(min(min(glove_vs_plane(clip, k, s, P0, N)) + 0.0, glove_vs_plane(clip, k, s, P0, N, tips=True) + TIP_IN - 0.004) for k in fr)
            if worst > -0.004: break
            gap += -worst - 0.002; run_frames(P0, Wb, gap)
        mm = palm_metrics(clip, fm, s, P0, N); pc = mm['pc'] - N * ((mm['pc'] - P0) @ N)
        Pw2, _ = world(tg, clip); wrist = Pw2[fm, tg.i('hand_' + s)]
        c['surface']['point'] = [round(float(x), 3) for x in pc]
        c['palm'] = {'inHand': [round(float(x), 3) for x in GLOVE[s]['inHand']], 'normalHand': [round(float(x), 3) for x in GLOVE[s]['nHand']],
                     'wrist': [round(float(x), 3) for x in wrist], 'gapCm': round(mm['gap'] * 100, 1), 'tiltDeg': round(mm['flat'], 1),
                     'gloveInsideCm': round(max(0.0, -mm['glove']) * 100, 1), 'armInsideCm': round(max(0.0, -mm['arm']) * 100, 1), 'thumbTipInsideCm': round(max(0.0, -mm['tip']) * 100, 1), 'surfaceMoved': round(float(off), 3),
                     'note': 'surface.point = centre of the drawn palm on the surface (glove rigid with the forearm, tilted <= %d deg so the thumb clears it); runtime IK: wrist = point - Rhand*inHand' % TILT}
        if wall or c['surface']['type'] in ('slope', 'dome'):
            dd = float(np.dot(pc * np.array([1, 0, 1.0]), -nz(N * np.array([1, 0, 1.0])))) if np.linalg.norm(N * [1, 0, 1]) > 0.2 else c['approach']['distance'][1]
            c['approach'] = dict(c['approach'], distance=[round(dd - 0.06, 3), round(dd, 3), round(dd + 0.08, 3)])
            if not wall: c['heightRange'] = [round(float(pc[1]) - 0.2, 3), round(float(pc[1]) + 0.2, 3)]
        else:
            c['heightRange'] = [round(float(pc[1]) - 0.1, 3), round(float(pc[1]) + 0.1, 3)]
            dd = float(pc[2]) if abs(N[2]) < 0.5 else c['approach']['distance'][1]
            c['approach'] = dict(c['approach'], distance=[round(dd - 0.08, 3), round(dd, 3), round(dd + 0.12, 3)])
        if wall: c['heightRange'] = [round(float(pc[1]) - 0.35, 3), round(float(pc[1]) + 0.3, 3)]
        REPORT.append((name, s, before[s], mm, round(body_vs_plane(clip, fm, P0, N, sides) * 100, 1)))
    NEWC[name] = clip
print('  clip                     hand  BEFORE: glove in cm / palm gap cm / normal off deg  ->  AFTER: glove in (all but 24 thumb-tip vertices) / arm in / thumb-tip in / palm gap / palm normal off -N / body gap')
for n, s, b, a, bg in REPORT:
    print('  %-24s %s   %5.1f / %5.1f / %3.0f   ->   %5.1f / %5.1f / %5.1f / %5.1f / %3.0f / %5.1f' % (n, s, max(0, -min(b['glove'], b['tip'])) * 100, b['gap'] * 100, b['flat'], max(0, -a['glove']) * 100, max(0, -a['arm']) * 100, max(0, -a['tip']) * 100, a['gap'] * 100, a['flat'], bg))

# meta req + heights follow the pose (family-level, from the loop clip)
for name in TARGETS:
    if FAM.get(family(name)) is None: continue
    m = META['clips'][name]; HC = hand_contacts(m); req = m.get('req') or {}
    ys = [c['surface']['point'][1] for c in HC]; lo, hi = min(ys), max(ys)
    if req.get('cls') == 'hands_wall': req['h'] = [round(lo - 0.25, 2), round(hi + 0.25, 2)]
    elif req.get('cls') in ('hands_ledge',): req['h'] = [round(lo - 0.12, 2), round(hi + 0.15, 2)]
    elif req.get('cls') in ('brace_slope', 'lean_dome'): req['h'] = [round(lo - 0.3, 2), round(hi + 0.3, 2)]
    if req: m['req'] = req

# ------------------------------------------------------------------ write: replace these clips, keep every other clip's accessors
_orig = RT.clip_tracks
def lean_tracks(tg_, clip, rot_tol=0.004, pos_tol=0.0012):
    tr = _orig(tg_, clip, rot_tol=rot_tol, pos_tol=pos_tol)
    for i, d in tr.items():
        if tg_.sk.names[i] != 'pelvis' and np.abs(clip['T'][:, i] - tg_.sk.T[i][None]).max() < 1e-5: d.pop('translation', None)
    return tr
RT.clip_tracks = lean_tracks
tmp = OUT + '/_palm_new.glb'
write_clips(tmp, tg, [(n, NEWC[n], {'loop': META['clips'][n]['loop']}) for n in TARGETS], dedup=True)
def glb_parts(p):
    b = open(p, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l])
    o = 20 + l; bl = struct.unpack('<I', b[o:o + 4])[0]; return j, bytes(b[o + 8:o + 8 + bl])
jo, bo = glb_parts(SRC); jn, bn = glb_parts(tmp)
assert [n['name'] for n in jo['nodes']] == [n['name'] for n in jn['nodes']]
newby = {a['name']: a for a in jn['animations']}
out_buf = bytearray(); views = []; accs = []; amap = {}
def take(j, b, ai, tagk):
    k = (tagk, ai)
    if k in amap: return amap[k]
    a = dict(j['accessors'][ai]); v = j['bufferViews'][a['bufferView']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    size = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}[a['type']] * 4 * a['count']
    while len(out_buf) % 4: out_buf.append(0)
    o = len(out_buf); out_buf.extend(b[off:off + size])
    views.append({'buffer': 0, 'byteOffset': o, 'byteLength': size}); a['bufferView'] = len(views) - 1; a.pop('byteOffset', None)
    accs.append(a); amap[k] = len(accs) - 1; return amap[k]
anims = []
for an in jo['animations']:
    src, j, b, t = (newby[an['name']], jn, bn, 'n') if an['name'] in newby else (an, jo, bo, 'o')
    a2 = dict(src); a2['samplers'] = [dict(sm, input=take(j, b, sm['input'], t), output=take(j, b, sm['output'], t)) for sm in src['samplers']]
    anims.append(a2)
jo['animations'] = anims; jo['accessors'] = accs; jo['bufferViews'] = views; jo['buffers'] = [{'byteLength': len(out_buf)}]
jo['extras'] = dict(jo.get('extras', {})); jo['extras']['palmFix'] = 'tools/anim/build_palm_fix.py'
js = json.dumps(jo, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(out_buf) % 4: out_buf.append(0)
open(OUT + '/anim_pilot_contact.glb', 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out_buf)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out_buf), 0x004E4942) + bytes(out_buf))
done = [n for n in TARGETS if FAM.get(family(n)) is not None]
for n in done:
    m = META['clips'][n]; m['palmFix'] = True
    m['notes'] = (m.get('notes', '') + ' | palm-fixed: forearm oriented so the drawn palm lies on the surface (palm centre = surface.point)').strip()
META['palm'] = {s: {'inHand': [round(float(x), 3) for x in GLOVE[s]['inHand']], 'normalHand': [round(float(x), 3) for x in GLOVE[s]['nHand']],
                    'inForearm': [round(float(x), 4) for x in GLOVE[s]['c']], 'normalForearm': [round(float(x), 4) for x in GLOVE[s]['Rt'] @ GLOVE[s]['n']],
                    'flatNormalForearm': [round(float(x), 4) for x in GLOVE[s]['n']], 'fingersForearm': [round(float(x), 4) for x in GLOVE[s]['Rt'] @ GLOVE[s]['f']],
                    'tiltDeg': round(GLOVE[s]['tilt'], 1),
                    'note': 'palm centre / normal of the DRAWN glove in the lowerarm bone frame (origin = elbow); normalForearm = the palm normal the clips lay on the surface (flat normal tilted by tiltDeg so the rigid thumb clears it)'} for s in 'lr'}
json.dump(META, open(OUT + '/anim_pilot_contact.meta.json', 'w'), indent=1)
os.remove(tmp)
print('written: %d clips re-posed, %d kept, %d target clips left as they were' % (len(done), len(anims) - len(TARGETS), len(TARGETS) - len(done)))
