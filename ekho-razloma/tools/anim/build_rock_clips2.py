"""Rock-interaction clips, wave 2 (ARCH-INTERACT.md step 7, Motion context), APPENDED to the shipped contact library.
usage: <Blender python> build_rock_clips2.py <workdir>
  workdir: pilot_aces_textured.glb, npz/{111_31,82_02,82_04}.npz (tools/anim/fbx_dump.py on CMU FBX),
           anim_pilot_contact.glb + anim_pilot_contact.meta.json (unpacked from the shipped pack: 49 clips)
writes <workdir>/out/anim_pilot_contact.glb + .meta.json = every shipped clip byte-for-byte + the clips below,
and a `req` block (MotionRequirements, the World vocabulary of ARCH-INTERACT.md) on EVERY clip, old and new.

  foot_on_ledge_l/_r _in/_loop/_out   CMU 111_31 (stepping up onto a 0.27 m step) -> lead foot on a 0.45 m ledge, hand on the knee
  duck_under / duck_under_half        UAL Crouch_Fwd_Loop / lowered Walk_Loop + right palm guiding along the underside
  jump_down_low / jump_down / _high   CMU 82_02 (0.66 m ledge) / 82_04 (0.86 m ledge), flight time-warped to 0.6 / 1.0 / 1.5 m
  knee_on_rock_l/_r _in/_loop         authored (no CMU take has a knee on a surface): knee + shin on a 0.5 m top, palm on the top
  lean_dome_l/_r _in/_loop            authored: palm on a rounded top 1.0-1.3 m, body inclined over it
  lean_low_in / _loop                 authored: perched against a 0.65-0.95 m edge behind, palms on its top beside the hips
  sit_uneven_l/_r (loop)              sit_rock_loop with one thigh 0.08 m higher (pelvis roll, spine counter-roll, feet kept)
  hand_wall_r/_l/_both_in_walk, lean_shoulder_r/_l_in_walk   0.35 s entries from Walk_Loop straight into the _loop pose
"""
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retarget as RT
from retarget import *
from author import *
from gltfio import *

W = sys.argv[1]
OUT = os.path.join(W, 'out'); os.makedirs(OUT, exist_ok=True)
tg = Target(W + '/pilot_aces_textured.glb')
FPS = 30.0
CMU_LIC = 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu) - free for all uses incl. commercial; FBX via cgspeed BVH / gbionics/cmu-fbx'
AUTH_LIC = 'authored for this project (key poses + IK on the UAL skeleton, UAL Idle base CC0) - same license as the game'
SURF_OFF = {'hand': 0.035, 'seat': 0.10, 'back': 0.16, 'knee': 0.06, 'foot': 0.0}
NEW = []
ip = tg.i('pelvis')

# ------------------------------------------------------------------ helpers (same conventions as build_rock_clips.py)
def contact(effector, bone, window, point, normal, surface, height_range, approach, hold=True, blend=(0.15, 0.2), note=None, space='character'):
    n = np.asarray(normal, float); n = n / np.linalg.norm(n)
    d = {'effector': effector, 'bone': bone, 'window': [round(float(window[0]), 3), round(float(window[1]), 3)],
         'blendIn': blend[0], 'blendOut': blend[1], 'hold': hold, 'surface': {'type': surface, 'point': [round(float(x), 3) for x in point], 'normal': [round(float(x), 3) for x in n]},
         'heightRange': [round(float(x), 3) for x in height_range], 'approach': approach, 'space': space}
    if note: d['note'] = note
    return d

def approach_for(point, normal, slack=(0.08, 0.12)):
    n = np.array(normal, float); nh = n * np.array([1, 0, 1.0])
    if np.linalg.norm(nh) < 1e-6: nh = np.array([0, 0, -1.0])
    nh /= np.linalg.norm(nh)
    d = float(np.dot(np.asarray(point) * np.array([1, 0, 1.0]), -nh))
    return {'distance': [round(d - slack[0], 3), round(d, 3), round(d + slack[1], 3)], 'facing': [round(float(-nh[0]), 3), 0, round(float(-nh[2]), 3)]}

def add(name, clip, loop, src, lic, contacts=(), notes='', tags=(), rm=None, extra=None):
    meta = {'name': name, 'duration': round(float(clip['times'][-1]), 4), 'loop': bool(loop), 'fps': FPS,
            'source': src, 'license': lic, 'tags': list(tags), 'contacts': list(contacts), 'notes': notes}
    if rm is not None:
        step = max(1, int(FPS / 15))
        meta['rootMotion'] = {'fps': FPS / step, 'units': 'm, rad (character space at clip start: +Z forward, +X left)',
                              'samples': [[round(float(x), 4) for x in r] for r in rm[::step]], 'total': [round(float(x), 4) for x in rm[-1]]}
    else: meta['rootMotion'] = None
    if extra: meta.update(extra)
    NEW.append((name, clip, meta)); print('  +', name, meta['duration'], 's', 'loop' if loop else '', flush=True)
    return meta

def palm_point(c, s, f):
    Pw, _ = world(tg, c)
    return Pw[f, tg.i('hand_' + s)] + (Pw[f, tg.i('middle_01_' + s)] - Pw[f, tg.i('hand_' + s)]) * 0.6

def mocap(nm, t0, t1):
    src = load_src(f'{W}/npz/{nm}.npz')
    return retarget(tg, src, f0=max(1, int(round(t0 * src['fps']))), f1=int(round(t1 * src['fps'])), fps=FPS)

def pin_feet(c, targets, w=None, pole=None):
    for s in 'lr':
        if s not in targets: continue
        Pw, Qw = world(tg, c)
        fwd = qrot(Qw[:, ip], np.array([0, 0, 1.0])) * np.array([1, 0, 1.0]) + np.array([0, 0.25, 1e-3])
        two_bone_ik(tg, c, ('thigh_' + s, 'calf_' + s, 'foot_' + s), targets[s], None if w is None else w, pole=fwd if pole is None else pole)

def crossfade_to(c, pose_T, pose_R, t0, t1=None):
    ts = c['times']
    t1 = ts[-1] if t1 is None else t1
    for f in range(len(ts)):
        if ts[f] < t0: continue
        u = min(1.0, (ts[f] - t0) / max(1e-6, t1 - t0)); u = u * u * (3 - 2 * u)
        c['R'][f] = qslerp(c['R'][f], pose_R, np.full(c['R'].shape[1], u)); c['T'][f] = c['T'][f] * (1 - u) + pose_T * u
    return c

def copy(c): return {k: (v.copy() if hasattr(v, 'copy') else v) for k, v in c.items()}

def resample(c, src_t):
    """new clip whose frame k = the pose of c at time src_t[k] (slerp between frames)"""
    u = np.clip(np.asarray(src_t) * c['fps'], 0, len(c['times']) - 1)
    k = np.floor(u).astype(int); k2 = np.minimum(k + 1, len(c['times']) - 1); a = u - k
    R = qslerp(c['R'][k], c['R'][k2], np.repeat(a[:, None], c['R'].shape[1], 1)); T = c['T'][k] * (1 - a[:, None, None]) + c['T'][k2] * a[:, None, None]
    return dict(times=np.arange(len(u)) / FPS, T=T, R=R, fps=FPS)

def shift_pelvis(c, dy):
    Pw, _ = world(tg, c); pel = Pw[:, ip].copy(); pel[:, 1] += dy; set_world_pelvis(tg, c, pel)

def static(c, f, dur):
    F = int(round(dur * FPS)) + 1
    return dict(times=np.arange(F) / FPS, T=np.repeat(c['T'][f][None], F, 0).copy(), R=np.repeat(c['R'][f][None], F, 0).copy(), fps=FPS)

def ual(name):
    sk = Skeleton(*read_glb(W + '/pilot_aces_textured.glb')); ai = sk.anim_names().index(name)
    ts, T, R = sk.sample(ai, FPS)
    Tl = np.repeat(tg.sk.T[None], len(ts), 0).copy(); Rl = np.repeat(tg.sk.R[None], len(ts), 0).copy()
    for i, nm in enumerate(tg.sk.names):
        if nm in sk.idx and nm not in ('Armature', 'root'): Rl[:, i] = R[:, sk.idx[nm]]
    Pw, Qw = sk.fk(T, R); ips = sk.idx['pelvis']
    c = dict(times=ts - ts[0], T=Tl, R=Rl, fps=FPS)
    Pt, Qt = world(tg, c); par = tg.sk.parent[ip]
    c['R'][:, ip] = qmul(qinv(Qt[:, par]), Qw[:, ips]); c['T'][:, ip] = qrot(qinv(Qt[:, par]), Pw[:, ips] - Pt[:, par])
    return c
IDLE = ual('Idle_Loop'); WALK = ual('Walk_Loop')

LIB = Skeleton(*read_glb(W + '/anim_pilot_contact.glb'))
def lib(name):
    ts, T, R = LIB.sample(LIB.anim_names().index(name), FPS)
    Tl = np.repeat(tg.sk.T[None], len(ts), 0).copy(); Rl = np.repeat(tg.sk.R[None], len(ts), 0).copy()
    for i, nm in enumerate(tg.sk.names):
        if nm in LIB.idx: Tl[:, i] = T[:, LIB.idx[nm]]; Rl[:, i] = R[:, LIB.idx[nm]]
    return dict(times=ts - ts[0], T=Tl, R=Rl, fps=FPS)
META = json.load(open(W + '/anim_pilot_contact.meta.json'))
IN = 0.6; LOOP = 2.5
def ramp(v0, v1, t0=0.0, t1=IN, hold_to=IN + LOOP): return [(t0, v0), (t1, v1), (hold_to, v1)]

def split_in_loop(name, c, cs_fn, src, lic, tags, notes, extra=None):
    n_in = int(IN * FPS)
    ci = trim(c, 0, n_in); cl = trim(c, n_in, n_in + int(LOOP * FPS))
    cs_in, cs_loop = cs_fn(c, n_in)
    add(name + '_in', ci, False, src, lic, cs_in, tags=tags, notes='enter (%.1f s, from Idle). ' % IN + notes, extra=extra)
    add(name + '_loop', cl, True, src, lic, cs_loop, tags=tags, notes='hold loop. ' + notes, extra=extra)

# ================================================================== FOOT ON LEDGE (CMU 111_31 step-up, lead foot left)
print('foot_on_ledge')
LEDGE = 0.45
c = mocap('111_31', 9.25, 10.35); despike(c)
Pw, _ = world(tg, c)
fl = Pw[:, tg.i('foot_l')].copy(); gy = float(tg.Pw[tg.i('foot_l'), 1])
top0 = float(np.median(fl[-8:, 1])) - gy                 # source step top under the ankle (~0.28 m)
lift = np.clip((fl[:, 1] - gy) / max(top0, 1e-3), 0, 1.25)
fl[:, 1] = gy + (fl[:, 1] - gy) * (LEDGE / top0)          # the same step, onto a 0.45 m ledge
fl[:, 2] += 0.06 * np.clip(lift, 0, 1)                    # a little further in: the whole sole on the top
lock_feet(tg, c)
Pw, _ = world(tg, c); fr = Pw[:, tg.i('foot_r')].copy()
pel = Pw[:, ip].copy(); pel[:, 2] += 0.05 * np.clip(lift, 0, 1); pel[:, 1] += 0.03 * np.clip(lift, 0, 1); set_world_pelvis(tg, c, pel)
pin_feet(c, {'l': fl, 'r': fr}, pole=np.repeat([[0, 0.45, 1.0]], len(c['times']), 0))
rm = extract_root_motion(tg, c)
Pw, _ = world(tg, c)
FOOT_TOP = Pw[-1, tg.i('foot_l')].copy(); BALL_TOP = Pw[-1, tg.i('ball_l')].copy()
# hold: last pose, hand on the raised knee, leaning in; slow breathing
base = static(c, len(c['times']) - 1, IN + LOOP)
Pb, _ = world(tg, base); knee = Pb[0, tg.i('calf_l')]
k = {'hand_l': ramp(list(palm_point(base, 'l', 0) - [0, 0, 0]), list(knee + [0.02, 0.06, 0.06]), 0, 0.5),
     'hand_l_w': [(0, 0), (0.45, 1), (IN + LOOP, 1)], 'palm_l': ramp([-1, 0, 0], [0, -1, 0.1], 0, 0.5), 'fingers_l': ramp([0, -1, 0], [0.1, 0, 1], 0, 0.5),
     'elbow_l': ramp([0.6, -0.5, -0.4], [0.7, 0.1, -0.5], 0, 0.5), 'spine': ramp([0, 0, 0], [14, -4, 0], 0, 0.5), 'neck': ramp([0, 0, 0], [-8, 0, 0], 0, 0.5),
     'pelvis_off': ramp([0, 0, 0], [0, -0.02, 0.04], 0, 0.5)}
hold = author(tg, base, k)
add_noise_layer(tg, hold, ['spine_02', 'spine_03'], 0.8, 0.35, seed=3)
h_loop = trim(hold, int(IN * FPS), len(hold['times']) - 1); make_loop(tg, h_loop)
c_in = copy(c)
# enter = the stepping motion, then the settle into the hold pose (0.5 s)
settle = trim(hold, 0, int(IN * FPS))
def cat(a, b):
    return dict(times=np.arange(len(a['times']) + len(b['times']) - 1) / FPS, T=np.concatenate([a['T'], b['T'][1:]]), R=np.concatenate([a['R'], b['R'][1:]]), fps=FPS)
c_in = cat(c_in, settle); rm_in = np.concatenate([rm, np.repeat(rm[-1:], len(settle['times']) - 1, 0)])
# out: foot back off the ledge (up and back, then down), body to the idle stance
c_out = static(h_loop, 0, 0.8)
Po, _ = world(tg, c_out); f0 = Po[0, tg.i('foot_l')]; fi = world(tg, IDLE)[0][0, tg.i('foot_l')]
ts_o = c_out['times']; u = np.clip(ts_o / ts_o[-1], 0, 1); s = u * u * (3 - 2 * u)
path = np.stack([f0[0] + (fi[0] - f0[0]) * s, f0[1] + (fi[1] - f0[1]) * np.clip((s - 0.35) / 0.65, 0, 1) + 0.05 * np.sin(np.pi * np.clip(s / 0.5, 0, 1)), f0[2] + (fi[2] - f0[2]) * np.clip(s / 0.6, 0, 1)], -1)
fr_o = Po[:, tg.i('foot_r')].copy()
crossfade_to(c_out, IDLE['T'][0], IDLE['R'][0], 0.0)
pin_feet(c_out, {'l': path, 'r': fr_o})
lock_feet(tg, c_out)
top_c = lambda win: contact('foot_l', 'foot_l', win, [FOOT_TOP[0], LEDGE, FOOT_TOP[2]], [0, 1, 0], 'ledge_top', [0.3, 0.8],
                            {'distance': [round(float(FOOT_TOP[2] - 0.20), 3), round(float(FOOT_TOP[2] - 0.12), 3), round(float(FOOT_TOP[2] - 0.08), 3)], 'facing': [0, 0, 1],
                             'note': 'distance from the feet origin to the ledge FRONT edge'},
                            note='lead (left) sole flat on a top %.2f m high; runtime scales the lift to the real top (IK, +-0.2 m)' % LEDGE)
src = {'cmu': '111_31 stepping up / stepping down (subject 111), 9.25-10.35 s', 'authored': 'ledge height 0.45, hand on the knee hold'}
T_in = c_in['times'][-1]
extra = {'ledge': {'height': LEDGE, 'lead': 'l'}}
add('foot_on_ledge_l_in', c_in, False, src, CMU_LIC + ' + ' + AUTH_LIC, [top_c((1.0, T_in))], tags=['contact', 'rock', 'ledge', 'rest'],
    notes='walking up to a ledge: the left foot goes up onto it, the left hand settles on the knee (%.1f s)' % T_in, rm=rm_in, extra=extra)
add('foot_on_ledge_l_loop', h_loop, True, src, AUTH_LIC, [top_c((0, h_loop['times'][-1]))], tags=['contact', 'rock', 'ledge', 'rest'],
    notes='rest: foot on the ledge, forearm on the knee, looking out', extra=extra)
add('foot_on_ledge_l_out', c_out, False, src, AUTH_LIC, [top_c((0, 0.2))], tags=['contact', 'rock', 'ledge', 'rest'], notes='foot back off the ledge to the idle stance', extra=extra)
for part, cc, r in (('in', c_in, rm_in), ('loop', h_loop, None), ('out', c_out, None)):
    m = mirror(tg, copy(cc)); mm = dict(NEW[[n for n, _, _ in NEW].index('foot_on_ledge_l_' + part)][2])
    cs = [dict(x, effector='foot_r', bone='foot_r', surface=dict(x['surface'], point=[-x['surface']['point'][0]] + x['surface']['point'][1:])) for x in mm['contacts']]
    add('foot_on_ledge_r_' + part, m, part == 'loop', src, mm['license'], cs, tags=mm['tags'], notes=mm['notes'].replace('left', 'right') + ' (mirror)',
        rm=None if r is None else r * np.array([-1, 1, -1.0]), extra={'ledge': {'height': LEDGE, 'lead': 'r'}})

# ================================================================== DUCK UNDER (UAL crouch walk / lowered walk + a hand on the underside)
# (CMU 01_13 "go under" was tried first: the subject limbo-leans backwards under a bar holding it with both hands - not a rock move)
print('duck_under')
HELMET = 0.38     # helmet top above the Head bone (pilot 1.90 m, Head bone 1.52 m in Idle)
CROUCH = ual('Crouch_Fwd_Loop')
def duck(base, name, src, pel_dy=0.0, spine=0.0):
    b = copy(base); d = b['times'][-1]
    Pb, _ = world(tg, b); head = Pb[:, tg.i('Head'), 1]
    top = float(head.max()) + pel_dy + HELMET
    k = {'hand_r': [(0, [-0.16, top - HELMET + 0.40, 0.30])], 'hand_r_w': [(0, 0.85)], 'palm_r': [(0, [0, 1, 0.1])], 'fingers_r': [(0, [0.2, 0.1, 1])],
         'elbow_r': [(0, [-0.8, -0.5, -0.2])]}
    if pel_dy: k['pelvis_off'] = [(0, [0, pel_dy, 0.02])]; k['knee_l'] = [(0, [0.1, 0.05, 1])]; k['knee_r'] = [(0, [-0.1, 0.05, 1])]
    if spine: k['spine'] = [(0, [spine, 0, 0])]; k['neck'] = [(0, [-spine * 0.8, 0, 0])]
    c = author(tg, b, k); make_loop(tg, c)
    Pw, _ = world(tg, c); hd = Pw[:, tg.i('Head'), 1]; clear = float(hd.max()) + HELMET
    pp = palm_point(c, 'r', 0)
    cs = [contact('hand_r', 'hand_r', (0, d), [pp[0], pp[1] + SURF_OFF['hand'], pp[2]], [0, -1, 0], 'overhang', [pp[1] - 0.1, pp[1] + 0.25],
                  {'distance': [-0.4, 0.0, 0.4], 'facing': [0, 0, 1], 'note': 'under the overhang'}, blend=(0.25, 0.3),
                  note='right palm guides along the underside (IK up to the real underside, lateral=free)')]
    add(name, c, True, src, AUTH_LIC if 'UAL' not in str(src) else 'UAL (CC0) + ' + AUTH_LIC, cs, tags=['contact', 'rock', 'overhang', 'traverse'],
        notes='crouched walk under an overhang, helmet top <= %.2f m; one palm on the underside. Play as locomotion (timeScale = speed / native)' % clear,
        extra={'overhang': {'clearance': round(clear, 3)}, 'locomotion': {'loop': True}})
    return clear
CLEAR_LO = duck(CROUCH, 'duck_under', {'ual': 'Crouch_Fwd_Loop', 'authored': 'hand on the underside'})
CLEAR_HI = duck(WALK, 'duck_under_half', {'ual': 'Walk_Loop', 'authored': 'pelvis -0.17, spine 24 deg, hand on the underside'}, pel_dy=-0.17, spine=24)
print('  clearance %.2f / %.2f' % (CLEAR_LO, CLEAR_HI))

# ================================================================== JUMP DOWN (CMU 82_02 / 82_04 "jump off ledge")
print('jump_down')
def jump(nm, t0, t1, h, name, tail=0.45):
    c0 = mocap(nm, t0, t1); despike(c0); ground_fix(tg, c0, pct=1); lock_feet(tg, c0)
    rmj = extract_root_motion(tg, c0)
    Pw, _ = world(tg, c0); ts = c0['times']
    feet = np.minimum(Pw[:, tg.i('foot_l'), 1], Pw[:, tg.i('foot_r'), 1]) - gy
    TOP = float(np.median(feet[:6])); k_off = int(np.where(feet < TOP - 0.06)[0][0]); k_land = k_off + int(np.where(feet[k_off:] < 0.06)[0][0])
    warp = np.sqrt(h / TOP); t_off, t_land = ts[k_off], ts[k_land]
    new_len = t_off + (t_land - t_off) * warp + (ts[-1] - t_land)
    nt = np.arange(int(round(new_len * FPS)) + 1) / FPS
    srct = np.where(nt < t_off, nt, np.where(nt < t_off + (t_land - t_off) * warp, t_off + (nt - t_off) / warp, nt - t_off - (t_land - t_off) * warp + t_land))
    c = resample(c0, srct)
    u = np.clip((srct - t_off) / (t_land - t_off), 0, 1); dy = (h - TOP) * (1 - u * u * (3 - 2 * u))
    shift_pelvis(c, dy)
    # settle on the idle stance (feet kept where they landed)
    ft = {s: world(tg, c)[0][:, tg.i('foot_' + s)].copy() for s in 'lr'}
    crossfade_to(c, IDLE['T'][0], IDLE['R'][0], c['times'][-1] - tail)
    pin_feet(c, ft)
    if not os.environ.get('JDBG'): shift_pelvis(c, -h)     # origin = the top surface at the take-off edge; the landing ground is h below (JDBG=1: preview on the landing ground)
    u2 = np.clip(np.asarray(srct) * FPS, 0, len(rmj) - 1).astype(int); r = rmj[u2]
    Pc, _ = world(tg, c); toe = float(max(Pc[0, tg.i('ball_l'), 2], Pc[0, tg.i('ball_r'), 2]))
    t_land_new = float(t_off + (t_land - t_off) * warp)
    cs = [contact('foot_' + s, 'foot_' + s, (0, float(t_off)), [float(Pc[0, tg.i('foot_' + s), 0]), 0, float(Pc[0, tg.i('foot_' + s), 2])], [0, 1, 0], 'drop_edge', [0.0, 0.05],
                  {'distance': [round(toe - 0.05, 3), round(toe + 0.05, 3), round(toe + 0.2, 3)], 'facing': [0, 0, 1], 'note': 'toes at the edge of the top'}, hold=False,
                  note='feet on the top before take-off; land %.2f m lower at %.2f s, %.2f m ahead' % (h, t_land_new, float(np.linalg.norm(r[-1, :2])))) for s in 'lr']
    add(name, c, False, {'cmu': '%s jump off ledge (subject 82), %.2f-%.2f s' % (nm, t0, t1), 'authored': 'drop %.2f m (source %.2f), flight time x%.2f, idle settle' % (h, TOP, warp)}, CMU_LIC, cs,
        tags=['contact', 'rock', 'drop'], notes='step off a %.2f m top and land with a knee bend; origin = top surface at the edge, y<0 after landing' % h,
        rm=r, extra={'drop': {'height': h, 'land': round(t_land_new, 3)}})
    print('  %s: source top %.2f, off %.2f land %.2f -> %.2f s' % (name, TOP, t_off, t_land, t_land_new))
jump('82_02', 9.7, 11.0, 0.6, 'jump_down_low')
jump('82_04', 1.2, 3.6, 1.0, 'jump_down')
jump('82_04', 1.2, 3.6, 1.5, 'jump_down_high')

# ================================================================== KNEE ON ROCK (authored)
print('knee_on_rock')
def knee_on(side):
    sg = 1 if side == 'l' else -1; other = 'r' if side == 'l' else 'l'
    H = 0.50; Zf = 0.36            # top height, front edge distance
    base = base_from(tg, IDLE['T'], IDLE['R'], IN + LOOP)
    P0, _ = world(tg, base); fo = P0[0, tg.i('foot_' + other)]; fs = P0[0, tg.i('foot_' + side)]
    th = float(np.linalg.norm(tg.Pw[tg.i('calf_' + side)] - tg.Pw[tg.i('thigh_' + side)])); sh = float(np.linalg.norm(tg.Pw[tg.i('foot_' + side)] - tg.Pw[tg.i('calf_' + side)]))
    # the knee rests 0.28 m in from the edge; the shin lies on the top back across the edge (ankle just past it, in the air)
    K = np.array([fs[0], H + SURF_OFF['knee'], Zf + 0.28])
    ank = K + sh * np.array([0, 0.10, -0.995])
    dz = 0.0
    for it in range(3):
        k = {'foot_' + side: [(0, list(fs)), (0.25, [fs[0], 0.35, fs[2] - 0.05]), (0.45, [fs[0], H + 0.16, Zf - 0.1]), (IN, list(ank)), (IN + LOOP, list(ank))],
             'foot_%s_rot' % side: ramp(0, 70), 'knee_' + side: ramp([sg * 0.25, 0.1, 1], [sg * 0.15, -0.6, 1]),
             'foot_' + other: ramp(list(fo), list(fo + [0, 0, -0.08])),
             'pelvis_off': ramp([0, 0, 0], [sg * 0.03, -0.10, 0.30 + dz]), 'pelvis_rot': ramp([0, 0, 0], [18, 0, -sg * 5]),
             'spine': ramp([0, 0, 0], [34, sg * 8, -sg * 6]), 'neck': ramp([0, 0, 0], [-28, 0, 0]), 'clav_' + side: ramp(0, -8),
             'hand_' + side: ramp([sg * 0.2, 0.9, 0.2], [sg * 0.32, H + 0.05, K[2] - 0.04]), 'hand_%s_w' % side: [(0, 0), (IN * 0.9, 1), (IN + LOOP, 1)],
             'palm_' + side: ramp([0, -1, 0.2], [0, -1, 0]), 'fingers_' + side: ramp([0, 0, 1], [0, 0, 1]), 'elbow_' + side: ramp([sg * 0.8, 0, -0.4], [sg * 0.8, 0, -0.4])}
        c = author(tg, copy(base), k)
        Pw, _ = world(tg, c); kn = Pw[-1, tg.i('calf_' + side)]
        err = np.linalg.norm(kn - K)
        print('  knee %s it%d: knee %s (want %s) err %.3f' % (side, it, kn.round(3), K.round(3), err))
        if err < 0.03: break
        dz += (K[2] - kn[2]) * 0.8 + (kn[1] - K[1]) * 0.6
    def cs_fn(c, n):
        Pw, _ = world(tg, c); kp = Pw[n + 5, tg.i('calf_' + side)]; pp = palm_point(c, side, n + 5)
        ap = {'distance': [Zf - 0.06, Zf, Zf + 0.08], 'facing': [0, 0, 1], 'note': 'distance from the feet origin to the top front edge'}
        kc = contact('knee_' + side, 'calf_' + side, (IN * 0.85, IN), [kp[0], kp[1] - SURF_OFF['knee'], kp[2]], [0, 1, 0], 'knee_top', [0.4, 0.7], ap,
                     note='%s knee %.2f m in from the edge, shin on the top (keyed top %.2f, measured knee %.2f)' % ('left' if sg > 0 else 'right', kp[2] - Zf, H, kp[1]))
        hc = contact('hand_' + side, 'hand_' + side, (IN * 0.9, IN), [pp[0], H, pp[2]], [0, 1, 0], 'knee_top', [0.4, 0.7], ap, note='same-side palm on the top beside the knee')
        return [kc, hc], [dict(kc, window=[0, LOOP]), dict(hc, window=[0, LOOP])]
    # the knee rises 0.5 m: 0.6 s read as a snap (calf 1050 deg/s) -> the enter is slowed to 1.0 s
    T_IN = 1.0; n2 = int(round(T_IN * FPS))
    srct = np.concatenate([np.linspace(0, IN, n2 + 1), IN + np.arange(1, int(LOOP * FPS) + 1) / FPS])
    c2 = resample(c, srct)
    ci = trim(c2, 0, n2); cl = trim(c2, n2, n2 + int(LOOP * FPS))
    cs_in, cs_loop = cs_fn(c2, n2)
    cs_in = [dict(x, window=[round(T_IN * 0.85, 3), T_IN]) for x in cs_in]
    src = {'authored': 'knee onto a low top, palm on it', 'base': 'UAL Idle_Loop'}; note = 'knee on a 0.4-0.7 m flat top (keyed for 0.5), other foot on the ground'
    add('knee_on_rock_' + side + '_in', ci, False, src, AUTH_LIC, cs_in, tags=['contact', 'rock', 'knee', 'rest'], notes='enter (%.1f s, from Idle). ' % T_IN + note)
    add('knee_on_rock_' + side + '_loop', cl, True, src, AUTH_LIC, cs_loop, tags=['contact', 'rock', 'knee', 'rest'], notes='hold loop. ' + note)
knee_on('l')
for part in ('in', 'loop'):     # the right side = exact mirror of the left (the Idle base is asymmetric: keyed separately it missed the top by 14 cm)
    i = [n for n, _, _ in NEW].index('knee_on_rock_l_' + part); _, cl, ml = NEW[i]
    cs = [dict(x, effector=x['effector'][:-2] + '_r', bone=x['bone'][:-2] + '_r', surface=dict(x['surface'], point=[-x['surface']['point'][0]] + x['surface']['point'][1:]),
               note=x.get('note', '').replace('left', 'right')) for x in ml['contacts']]
    add('knee_on_rock_r_' + part, mirror(tg, copy(cl)), part == 'loop', ml['source'], ml['license'], cs, tags=ml['tags'], notes=ml['notes'] + ' (mirror of the left)')

# ================================================================== LEAN ON A DOME (authored)
print('lean_dome')
DOME_N = np.array([0, 0.8, -0.6]); DOME_N /= np.linalg.norm(DOME_N)
def dome(side):
    sg = 1 if side == 'l' else -1; other = 'r' if side == 'l' else 'l'
    y = 1.10; z = 0.40
    k = {'spine': ramp([0, 0, 0], [16, sg * 8, -sg * 3]), 'neck': ramp([0, 0, 0], [-6, sg * 6, 0]), 'pelvis_off': ramp([0, 0, 0], [sg * 0.03, -0.02, -0.03]),
         'pelvis_rot': ramp([0, 0, 0], [4, sg * 10, 0]),
         'hand_' + side: ramp([sg * 0.18, 0.95, 0.15], [sg * 0.12, y, z]), 'hand_%s_w' % side: [(0, 0), (IN * 0.85, 1), (IN + LOOP, 1)],
         'palm_' + side: ramp([0, -0.4, 1], list(-DOME_N)), 'fingers_' + side: ramp([0, 0, 1], [-sg * 0.3, 0.6, 0.8]), 'flat_' + side: ramp(1, 0.7),
         'elbow_' + side: ramp([sg * 0.8, -0.5, -0.3], [sg * 0.9, -0.4, -0.3]),
         'hand_' + other: ramp([-sg * 0.25, 0.95, 0.05], [-sg * 0.2, 0.98, 0.12]), 'hand_%s_w' % other: ramp(0, 0.5),
         'foot_' + other: None}
    del k['foot_' + other]
    c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], IN + LOOP), k)
    def cs_fn(c, n):
        pp = palm_point(c, side, n + 5); pt = pp - DOME_N * SURF_OFF['hand']
        d = contact('hand_' + side, 'hand_' + side, (IN * 0.85, IN), pt, DOME_N, 'dome', [0.85, 1.3], approach_for(pt, DOME_N, (0.08, 0.12)),
                    note='palm on the rising front of a rounded top (normal tilted 37 deg toward the character); body inclined over it, weight on the %s arm' % ('left' if sg > 0 else 'right'))
        return [d], [dict(d, window=[0, LOOP])]
    split_in_loop('lean_dome_' + side, c, cs_fn, {'authored': 'palm on a rounded top', 'base': 'UAL Idle_Loop'}, AUTH_LIC, ['contact', 'rock', 'dome', 'rest'],
                  'rounded top 0.85-1.3 m (keyed for 1.1)')
dome('r'); dome('l')

# ================================================================== LEAN LOW (perch on a low edge behind)
print('lean_low')
EDGE = 0.80
base = base_from(tg, IDLE['T'], IDLE['R'], IN + LOOP)
P0, _ = world(tg, base)
k = {}
for s in 'lr':
    f0 = P0[0, tg.i('foot_' + s)]; k['foot_' + s] = [(0, list(f0)), (IN * 0.7, list(f0 + [0, 0, 0.30])), (IN + LOOP, list(f0 + [0, 0, 0.30]))]
k['pelvis_off'] = ramp([0, 0, 0], [0, -0.10, -0.02]); k['pelvis_rot'] = ramp([0, 0, 0], [-6, 0, 0]); k['spine'] = ramp([0, 0, 0], [4, 0, 0]); k['neck'] = ramp([0, 0, 0], [-4, 0, 0])
for s, sg in (('l', 1), ('r', -1)):
    k['hand_' + s] = ramp([sg * 0.26, 0.85, 0.0], [sg * 0.27, EDGE + 0.02, -0.20]); k['hand_%s_w' % s] = [(0, 0), (IN * 0.9, 1), (IN + LOOP, 1)]
    k['palm_' + s] = ramp([sg, 0, 0], [0, -1, 0]); k['fingers_' + s] = ramp([0, -1, 0], [0, -0.2, 1]); k['elbow_' + s] = ramp([sg * 0.5, -0.4, -0.8], [sg * 0.4, 0.1, -1])
c = author(tg, base, k)
def low_cs(c, n):
    Pw, _ = world(tg, c); pz = Pw[n + 5, ip, 2]
    ap = {'distance': [round(float(-pz + 0.10), 3), round(float(-pz + 0.14), 3), round(float(-pz + 0.20), 3)], 'facing': [0, 0, -1], 'note': 'distance from the feet origin BACK to the edge; faces AWAY from the rock'}
    bc = contact('seat', 'pelvis', (IN * 0.9, IN), [0, EDGE - 0.08, float(pz - 0.14)], [0, 0, 1], 'edge_back', [0.65, 0.95], ap,
                 note='buttocks / lower back against the edge of a %.2f m top behind, feet forward' % EDGE)
    out = [bc]
    for s in 'lr':
        pp = palm_point(c, s, n + 5); out.append(contact('hand_' + s, 'hand_' + s, (IN * 0.9, IN), [pp[0], EDGE, pp[2]], [0, 1, 0], 'edge_back', [0.65, 0.95], ap, note='palm on the top beside the hip'))
    return out, [dict(x, window=[0, LOOP]) for x in out]
split_in_loop('lean_low', c, low_cs, {'authored': 'perch against a low edge', 'base': 'UAL Idle_Loop'}, AUTH_LIC, ['contact', 'rock', 'lean', 'rest'], 'low edge 0.65-0.95 m behind (keyed for 0.8)')

# ================================================================== SIT UNEVEN (sit_rock_loop, one thigh higher)
print('sit_uneven')
sl = lib('sit_rock_loop'); sm = META['clips']['sit_rock_loop']
for side, sg in (('l', 1), ('r', -1)):
    b = copy(sl); d = b['times'][-1]
    k = {'pelvis_rot': [(0, [0, 0, -sg * 9])], 'pelvis_off': [(0, [0, 0.035, 0])], 'spine': [(0, [0, 0, sg * 8])], 'neck': [(0, [0, 0, sg * 2])]}
    c = author(tg, b, k); make_loop(tg, c)
    cs = [dict(x, surface=dict(x['surface'], normal=[round(float(-sg * np.sin(9 * DEG)), 3), round(float(np.cos(9 * DEG)), 3), 0]),
               note='seat top uneven: the %s thigh rests ~0.07 m higher (pelvis rolled 9 deg, spine upright)' % ('left' if sg > 0 else 'right')) for x in sm['contacts']]
    add('sit_uneven_' + side, c, True, {'from': 'sit_rock_loop', 'authored': 'pelvis roll + spine counter-roll'}, sm['license'], cs, tags=['contact', 'rock', 'sit', 'rest'],
        notes='seated on an uneven top; enter / exit through sit_rock_in / sit_rock_out with a 0.35 s crossfade')

# ================================================================== ENTRIES FROM WALKING (0.35 s into the _loop pose)
print('walk entries')
WIN = 0.35
Pw_w, _ = world(tg, WALK)
fl_y = Pw_w[:, tg.i('foot_l'), 1]; fr_y = Pw_w[:, tg.i('foot_r'), 1]
# start at the frame where the right foot is planted and the left is lifting (mid stride)
f0 = int(np.argmax((fr_y < np.percentile(fr_y, 20)) & (fl_y > np.percentile(fl_y, 60))))
for nm in ('hand_wall_r', 'hand_wall_l', 'hand_wall_both', 'lean_shoulder_r', 'lean_shoulder_l'):
    loop = lib(nm + '_loop'); lm = META['clips'][nm + '_loop']
    F = int(round(WIN * FPS)) + 1
    idx = (np.arange(F) + f0) % (len(WALK['times']) - 1)
    c = dict(times=np.arange(F) / FPS, T=WALK['T'][idx].copy(), R=WALK['R'][idx].copy(), fps=FPS)
    crossfade_to(c, loop['T'][0], loop['R'][0], 0.0)
    lock_feet(tg, c)
    cs = [dict(x, window=[round(WIN * 0.7, 3), WIN], blendIn=0.12) for x in lm['contacts']]
    add(nm + '_in_walk', c, False, {'from': 'UAL Walk_Loop -> ' + nm + '_loop first pose'}, AUTH_LIC, cs, tags=lm['tags'] + ['walk'],
        notes='enter straight from walking (%.2f s, feet settle, hand / shoulder reaches the face); then play %s_loop' % (WIN, nm))

# ================================================================== MotionRequirements on EVERY clip (ARCH-INTERACT.md vocabulary)
# cls: affordance class · h: support height range (m, over the stand ground) the clip serves after fitting · tilt: face tilt
# range (rad, 0 = vertical face; + leans away = overhang is -) · feet: allowed ground height difference under the feet ·
# stretch: how far the MotionFitter may move the contact (m) / tilt the spine (rad) / scale the lift before it stops being natural
def R(cls, h=None, tilt=(-0.15, 0.3), feet=0.08, stretch=(0.15, 0.2), extra=None):
    d = {'cls': cls, 'h': None if h is None else [round(h[0], 3), round(h[1], 3)], 'tilt': [tilt[0], tilt[1]] if tilt else None, 'feetDelta': feet,
         'stretch': {'contact': stretch[0], 'spine': stretch[1]}}
    if extra: d.update(extra)
    return d
REQ = {
    'hand_wall_r': R('hands_wall', (1.0, 1.6)), 'hand_wall_l': R('hands_wall', (1.0, 1.6)), 'hand_wall_both': R('hands_wall', (1.0, 1.6), extra={'width': 0.4}),
    'lean_shoulder_r': R('lean_shoulder', (1.1, 1.9), tilt=(-0.1, 0.2)), 'lean_shoulder_l': R('lean_shoulder', (1.1, 1.9), tilt=(-0.1, 0.2)),
    'lean_back': R('lean_back', (1.0, 2.2), tilt=(-0.05, 0.25)), 'lean_hands_ledge': R('hands_ledge', (0.55, 1.05), tilt=None, extra={'flat': True}),
    'brace_slope_r': R('brace_slope', (0.1, 0.35), tilt=(0.35, 0.9), feet=0.25), 'brace_slope_l': R('brace_slope', (0.1, 0.35), tilt=(0.35, 0.9), feet=0.25),
    'vault_1m': R('climb', (0.8, 1.2), tilt=None, extra={'flat': True}), 'step_over': R('step_up', (0.15, 0.5), tilt=None),
    'push_heavy': R('push', (0.8, 1.5)), 'reach_branch_r': R('touch', (1.4, 2.1)), 'reach_branch_l': R('touch', (1.4, 2.1)),
    'crouch_inspect': R('ground', (0.0, 0.1), tilt=None), 'pickup_small_r': R('ground', (0.0, 0.3), tilt=None), 'pickup_small_l': R('ground', (0.0, 0.3), tilt=None),
    'kneel': R('ground', (0.0, 0.1), tilt=None),
    'sit_rock': R('sit', (0.37, 0.5), tilt=None, extra={'flat': True, 'facesAway': True}), 'sit_rock_high': R('sit', (0.54, 0.67), tilt=None, extra={'flat': True, 'facesAway': True}),
    'sit_uneven_l': R('sit', (0.37, 0.55), tilt=None, extra={'uneven': [0.03, 0.1], 'facesAway': True}), 'sit_uneven_r': R('sit', (0.37, 0.55), tilt=None, extra={'uneven': [0.03, 0.1], 'facesAway': True}),
    'touch_walk_r': R('touch_walk', (0.85, 1.45), tilt=(-0.2, 0.4), extra={'layer': True, 'speed': [0.4, 1.5]}),
    'touch_walk_l': R('touch_walk', (0.85, 1.45), tilt=(-0.2, 0.4), extra={'layer': True, 'speed': [0.4, 1.5]}),
    'squeeze_side_r': R('squeeze', (1.0, 1.6), tilt=(-0.15, 0.15), extra={'gap': [0.6, 1.0]}), 'squeeze_side_l': R('squeeze', (1.0, 1.6), tilt=(-0.15, 0.15), extra={'gap': [0.6, 1.0]}),
    'foot_on_ledge_l': R('foot_on', (0.3, 0.8), tilt=None, stretch=(0.2, 0.15), extra={'flat': True}), 'foot_on_ledge_r': R('foot_on', (0.3, 0.8), tilt=None, stretch=(0.2, 0.15), extra={'flat': True}),
    'knee_on_rock_l': R('knee_on', (0.4, 0.7), tilt=None, stretch=(0.12, 0.15), extra={'flat': True, 'depth': 0.45}), 'knee_on_rock_r': R('knee_on', (0.4, 0.7), tilt=None, stretch=(0.12, 0.15), extra={'flat': True, 'depth': 0.45}),
    'lean_dome_l': R('lean_dome', (0.85, 1.3), tilt=(0.4, 1.0), extra={'round': [0.1, 1.0]}), 'lean_dome_r': R('lean_dome', (0.85, 1.3), tilt=(0.4, 1.0), extra={'round': [0.1, 1.0]}),
    'lean_low': R('lean_low', (0.65, 0.95), tilt=(-0.1, 0.3), extra={'facesAway': True, 'flat': True}),
    'duck_under': R('duck', None, tilt=None, extra={'clearance': [round(CLEAR_LO + 0.03, 2), round(CLEAR_HI, 2)]}), 'duck_under_half': R('duck', None, tilt=None, extra={'clearance': [round(CLEAR_HI + 0.03, 2), 1.75]}),
    'jump_down_low': R('jump_down', (0.45, 0.8), tilt=None, extra={'drop': True}), 'jump_down': R('jump_down', (0.8, 1.25), tilt=None, extra={'drop': True}),
    'jump_down_high': R('jump_down', (1.25, 1.7), tilt=None, extra={'drop': True}),
    'slip_recover': R('other'), 'catch_balance': R('other'), 'cold_shiver': R('other'), 'tired_hands_knees': R('other'), 'tired_breath': R('other'),
    'look_around': R('other'), 'point_r': R('other'), 'point_l': R('other'), 'wave_r': R('other'),
}
def req_for(name):
    b = name
    for suf in ('_in_walk', '_in', '_loop', '_out'):
        if b.endswith(suf): b = b[:-len(suf)]; break
    r = REQ.get(b)
    if r is None: return None
    r = dict(r); r['phase'] = 'enter' if name.endswith(('_in', '_in_walk')) else 'hold' if name.endswith('_loop') or (name in META['clips'] and META['clips'][name].get('loop')) else 'exit' if name.endswith('_out') else 'once'
    if name.endswith('_in_walk'): r['from'] = 'walk'
    return r

# ================================================================== write + merge onto the shipped library
# size: the wave-1 library ships every joint's translation track even where it is the constant rest offset (+~0.9 MB of glTF JSON
# for 28 clips). three.js leaves a property that no playing action animates at its bind value, which IS that rest offset, so the new
# clips carry translation tracks only where they move (pelvis, and any bone an edit displaced).
_orig_tracks = RT.clip_tracks
def lean_tracks(tg_, clip, rot_tol=0.005, pos_tol=0.0015):
    tr = _orig_tracks(tg_, clip, rot_tol=rot_tol, pos_tol=pos_tol)
    for i, d in tr.items():
        T = clip['T'][:, i]
        if tg_.sk.names[i] != 'pelvis' and np.abs(T - tg_.sk.T[i][None]).max() < 1e-5: d.pop('translation', None)
    return tr
RT.clip_tracks = lean_tracks
tmp = OUT + '/_rock2_new.glb'
write_clips(tmp, tg, [(n, c, {'loop': m['loop']}) for n, c, m in NEW], dedup=True)
def glb_parts(p):
    b = open(p, 'rb').read(); l = struct.unpack('<I', b[12:16])[0]; j = json.loads(b[20:20 + l])
    o = 20 + l; bl = struct.unpack('<I', b[o:o + 4])[0]; return j, bytearray(b[o + 8:o + 8 + bl])
jo, bo = glb_parts(W + '/anim_pilot_contact.glb'); jn, bn = glb_parts(tmp)
assert [n['name'] for n in jo['nodes']] == [n['name'] for n in jn['nodes']], 'skeleton node order differs - cannot merge'
have = {a['name'] for a in jo['animations']}
for n, _, _ in NEW: assert n not in have, 'clip already in the library: ' + n
while len(bo) % 4: bo.append(0)
boff, voff, aoff = len(bo), len(jo['bufferViews']), len(jo['accessors'])
bo.extend(bn)
for v in jn['bufferViews']: v = dict(v); v['byteOffset'] = v.get('byteOffset', 0) + boff; jo['bufferViews'].append(v)
for a in jn['accessors']: a = dict(a); a['bufferView'] += voff; jo['accessors'].append(a)
for an in jn['animations']:
    for s in an['samplers']: s['input'] += aoff; s['output'] += aoff
    jo['animations'].append(an)
jo['buffers'][0]['byteLength'] = len(bo)
meta = META
for n, _, m in NEW: meta['clips'][n] = m
missing = []
for n, m in meta['clips'].items():
    r = req_for(n)
    if r is None: missing.append(n)
    else: m['req'] = r
meta['req'] = {'doc': 'ARCH-INTERACT.md MotionRequirements', 'fields': {'cls': 'affordance class', 'h': 'support height range, m over the stand ground',
               'tilt': 'face tilt range, rad (0 vertical, + leans away, - overhang)', 'feetDelta': 'allowed ground height difference under the feet, m',
               'stretch.contact': 'max contact displacement the MotionFitter may apply, m', 'stretch.spine': 'max extra spine tilt, rad', 'phase': 'enter / hold / exit / once', 'from': 'entry source pose'}}
print('req on %d clips, missing: %s' % (len(meta['clips']) - len(missing), missing))
jo['extras'] = dict(jo.get('extras', {})); jo['extras'].pop('animlib', None)
jo['extras']['rockClips2'] = 'tools/anim/build_rock_clips2.py'
js = json.dumps(jo, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(bo) % 4: bo.append(0)
open(OUT + '/anim_pilot_contact.glb', 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bo)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bo), 0x004E4942) + bytes(bo))
json.dump(meta, open(OUT + '/anim_pilot_contact.meta.json', 'w'), indent=1)
os.remove(tmp)
print('merged: %d old + %d new clips' % (len(have), len(NEW)))
