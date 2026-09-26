"""Builds the pilot/hermit contact & interaction clip library (UAL skeleton, 65 joints).
usage: python3.11 build_pilot.py <workdir>   (workdir has pilot_aces_textured.glb, npc_hermit.glb, npz/, src/UAL1_Standard.glb)
writes <workdir>/out/anim_pilot_contact.glb + anim_pilot_contact.meta.json
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from retarget import *
from author import *

W = sys.argv[1]
OUT = os.path.join(W, 'out'); os.makedirs(OUT, exist_ok=True)
tg = Target(W + '/pilot_aces_textured.glb')
FPS = 30.0
CMU_LIC = 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu) - free for all uses incl. commercial; FBX via cgspeed BVH / gbionics/cmu-fbx'
UAL_LIC = 'Quaternius Universal Animation Library - CC0 1.0'
AUTH_LIC = 'authored for this project (key poses + IK on the UAL skeleton, UAL Idle base CC0) - same license as the game'

def ual_clip(glb, name, fps=FPS):
    sk = Skeleton(*read_glb(glb)); ai = sk.anim_names().index(name)
    ts, T, R = sk.sample(ai, fps)
    # map by name onto pilot skeleton (identical rest), keep pilot rest translations except pelvis
    n = tg.sk.n; F = len(ts)
    Tl = np.repeat(tg.sk.T[None], F, 0).copy(); Rl = np.repeat(tg.sk.R[None], F, 0).copy()
    for i, nm in enumerate(tg.sk.names):
        if nm in sk.idx and nm not in ('Armature', 'root'):
            Rl[:, i] = R[:, sk.idx[nm]]
    # pelvis from the source world transform (root-motion variants animate 'root')
    Pw, Qw = sk.fk(T, R); ip = sk.idx['pelvis']
    c = dict(times=ts - ts[0], T=Tl, R=Rl, fps=fps)
    Pt, Qt = world(tg, c); jp = tg.i('pelvis'); par = tg.sk.parent[jp]
    c['R'][:, jp] = qmul(qinv(Qt[:, par]), Qw[:, ip]); c['T'][:, jp] = qrot(qinv(Qt[:, par]), Pw[:, ip] - Pt[:, par])
    return c

IDLE = ual_clip(W + '/pilot_aces_textured.glb', 'Idle_Loop')
FOLD = ual_clip(W + '/npc_hermit.glb', 'Idle_FoldArms_Loop')

LIB = []     # (name, clip, meta)

# ------------------------------------------------------------------ contact helpers
SURF_OFF = {'hand': 0.035, 'shoulder': 0.10, 'back': 0.16, 'foot': 0.0}

def bone_w(c, bone):
    Pw, Qw = world(tg, c); return Pw[:, tg.i(bone)], Qw[:, tg.i(bone)]

def palm_point(c, side, f):
    Pw, Qw = world(tg, c)
    h = Pw[f, tg.i('hand_' + side)]; m = Pw[f, tg.i('middle_01_' + side)]
    return h + (m - h) * 0.6

def contact(effector, bone, window, point, normal, surface, height_range, approach, hold=True, blend=(0.15, 0.2), note=None, space='character'):
    n = np.asarray(normal, float); n = n / np.linalg.norm(n)
    d = {'effector': effector, 'bone': bone, 'window': [round(float(window[0]), 3), round(float(window[1]), 3)],
         'blendIn': blend[0], 'blendOut': blend[1], 'hold': hold, 'surface': {'type': surface, 'point': [round(float(x), 3) for x in point], 'normal': [round(float(x), 3) for x in n]},
         'heightRange': [round(float(x), 3) for x in height_range], 'approach': approach, 'space': space}
    if note: d['note'] = note
    return d

def approach_for(point, normal, slack=(0.08, 0.12)):
    """distance from the character origin (between the feet) to the surface plane, measured along -normal (horizontal)"""
    n = np.array(normal, float); nh = n * np.array([1, 0, 1.0])
    if np.linalg.norm(nh) < 0.3: return {'distance': [0, 0, 0], 'axis': 'down'}
    nh /= np.linalg.norm(nh)
    d = float(np.dot(np.asarray(point) * np.array([1, 0, 1.0]), -nh))
    return {'distance': [round(d - slack[0], 3), round(d, 3), round(d + slack[1], 3)], 'facing': [round(float(-nh[0]), 3), 0, round(float(-nh[2]), 3)]}

def add(name, clip, loop, src, lic, contacts=(), notes='', tags=(), rm=None, extra=None):
    meta = {'name': name, 'duration': round(float(clip['times'][-1]), 4), 'loop': bool(loop), 'fps': FPS,
            'source': src, 'license': lic, 'tags': list(tags), 'contacts': list(contacts), 'notes': notes}
    if rm is not None and (np.abs(rm[-1, :2]).max() > 0.15 or abs(rm[-1, 2]) > 0.26 or np.abs(rm[:, :2]).max() > 0.25):
        step = max(1, int(FPS / 15))
        meta['rootMotion'] = {'fps': FPS / step, 'units': 'm, rad (character space at clip start: +Z forward, +X left)',
                              'samples': [[round(float(x), 4) for x in r] for r in rm[::step]],
                              'total': [round(float(x), 4) for x in rm[-1]]}
    else:
        meta['rootMotion'] = None
    if extra: meta.update(extra)
    LIB.append((name, clip, meta)); print('  +', name, meta['duration'], 's', 'loop' if loop else '', flush=True)
    return meta

def mocap(nm, t0, t1, fps=FPS):
    src = load_src(f'{W}/npz/{nm}.npz')
    f0 = max(1, int(round(t0 * src['fps']))); f1 = int(round(t1 * src['fps']))
    return retarget(tg, src, f0=f0, f1=f1, fps=fps)

def finish_mocap(c, loop=False, loop_search=0.4, feet=True, travel=False):
    """travel clips: pin feet in world, then move the travel into the rootMotion curve (feet stay planted once the
    runtime applies the curve). Stationary clips: remove the drift first, then pin the feet in place (truly in-place)."""
    despike(c)
    if travel:
        segs = lock_feet(tg, c) if feet else {}
        rm = extract_root_motion(tg, c)
    else:
        extract_root_motion(tg, c); rm = None
        segs = lock_feet(tg, c) if feet else {}
    if loop:
        F = len(c['times']); k = int(loop_search * FPS)
        d, i, j = find_loop(c, tg, 0, k, F - 1 - k, F - 1)
        c = trim(c, i, j); make_loop(tg, c); rm = None
    return c, rm, segs

def hand_contacts_auto(c, side, kind, t_range=None, vthr=0.35):
    Pw, Qw = world(tg, c)
    h = Pw[:, tg.i('hand_' + side)]; ts = c['times']
    v = np.linalg.norm(np.gradient(h, axis=0), axis=-1) * FPS
    ok = v < vthr
    if kind == 'ground': ok &= h[:, 1] < h[:, 1].min() + 0.05
    if t_range: ok &= (ts >= t_range[0]) & (ts <= t_range[1])
    segs = contacts(1.0 - ok.astype(float), v * 0, 0.5, 1, minlen=3)
    if not segs: return None
    s0, s1 = max(segs, key=lambda s: s[1] - s[0])
    # pin the hand during the contact (removes mocap hand slip)
    tgt = h.copy(); w = np.zeros(len(h)); pin = h[s0:s1 + 1].mean(0)
    if kind == 'ground': pin[1] = h[s0:s1 + 1, 1].min()
    tgt[s0:s1 + 1] = pin; w[s0:s1 + 1] = 1
    for k in range(1, 9):
        for f in (s0 - k, s1 + k):
            if 0 <= f < len(h): tgt[f] = pin; w[f] = max(w[f], 0.5 + 0.5 * np.cos(np.pi * k / 9))
    two_bone_ik(tg, c, ('upperarm_' + side, 'lowerarm_' + side, 'hand_' + side), tgt, w)
    pp = palm_point(c, side, (s0 + s1) // 2)
    return s0, s1, pp

# ================================================================== MOCAP (CMU)
print('mocap')
# wave (right hand)
c, rm, _ = finish_mocap(mocap('141_16', 0.05, 2.35))
add('wave_r', c, False, {'cmu': '141_16 Wave Hello', 'window_s': [0.05, 2.35]}, CMU_LIC, tags=['gesture', 'social'],
    notes='one-shot; right hand. Layer over locomotion upper body only if needed (mask spine_02 and up).',
    extra={'gesture': {'effector': 'hand_r', 'peak': [0.3, 1.4]}})

# pick up small object from the ground (right hand)
c, rm, _ = finish_mocap(mocap('137_27', 5.0, 7.3))
r = hand_contacts_auto(c, 'r', 'ground')
cs = []
if r:
    s0, s1, pp = r
    cs.append(contact('hand_r', 'hand_r', (s0 / FPS, s1 / FPS), [pp[0], 0.0, pp[2]], [0, 1, 0], 'ground', [-0.25, 0.3],
                      {'distance': [0.25, round(float(pp[2]), 3), 0.7], 'facing': [0, 0, 1], 'lateral': round(float(pp[0]), 3)},
                      hold=False, note='grab moment = window start; attach the object to hand_r at window end'))
m = add('pickup_small_r', c, False, {'cmu': '137_27 Normal Pick Up', 'window_s': [5.0, 7.3]}, CMU_LIC, cs, tags=['pickup', 'ground'], rm=rm,
        notes='squat + right-hand grab from the ground; object ~0.3 m in front, slightly right')
cl = mirror(tg, c)
add('pickup_small_l', cl, False, {'cmu': '137_27 (mirrored)', 'window_s': [5.0, 7.3]}, CMU_LIC,
    [dict(x, effector='hand_l', bone='hand_l', surface=dict(x['surface'], point=[-x['surface']['point'][0]] + x['surface']['point'][1:]),
          approach=dict(x['approach'], lateral=-x['approach']['lateral'])) for x in cs], tags=['pickup', 'ground'], notes='mirror of pickup_small_r')

# crouch and inspect the ground (both hands)
c, rm, _ = finish_mocap(mocap('77_08', 0.8, 3.8))
cs = []
for s in 'lr':
    r = hand_contacts_auto(c, s, 'ground', (1.2, 2.9))
    if r:
        s0, s1, pp = r
        cs.append(contact('hand_' + s, 'hand_' + s, (s0 / FPS, s1 / FPS), [pp[0], 0.0, pp[2]], [0, 1, 0], 'ground', [-0.3, 0.3],
                          {'distance': [0.3, round(float(pp[2]), 3), 0.9], 'facing': [0, 0, 1]}, hold=False))
add('crouch_inspect', c, False, {'cmu': '77_08 investigating thing on ground with two hands', 'window_s': [0.8, 3.8]}, CMU_LIC, cs,
    tags=['ground', 'inspect'], rm=rm, notes='one-shot: crouch, both hands touch/probe the ground ~0.7 m ahead, stand up')

# kneel (in / loop / out)
full = mocap('23_03', 0.2, 5.0)
despike(full); extract_root_motion(tg, full); lock_feet(tg, full)
k_in = trim(full, 0, int(1.75 * FPS)); k_loop = trim(full, int(1.75 * FPS), int(3.85 * FPS)); k_out = trim(full, int(3.85 * FPS), len(full['times']) - 1)
d, i, j = find_loop(k_loop, tg, 0, 10, len(k_loop['times']) - 12, len(k_loop['times']) - 1); k_loop = trim(k_loop, i, j); lock_feet(tg, k_loop); make_loop(tg, k_loop)
Pw, _ = world(tg, k_loop)
kn = Pw[:, [tg.i('calf_l'), tg.i('calf_r')], 1].mean(0)
note = 'knee heights over loop: L %.2f m, R %.2f m' % (kn[0], kn[1])
src = {'cmu': '23_03 B kneels, comforts A (subject B)', 'window_s': [0.2, 5.0]}
add('kneel_in', k_in, False, src, CMU_LIC, tags=['kneel'], notes='stand -> low kneel/squat. ' + note)
add('kneel_loop', k_loop, True, src, CMU_LIC, tags=['kneel'], notes='hold; ' + note)
add('kneel_out', k_out, False, src, CMU_LIC, tags=['kneel'], notes='kneel -> stand')

# step over a low obstacle (walk-in, right leg leads over ~0.45 m)
c, rm, segs = finish_mocap(mocap('141_09', 0.0, 1.93), travel=True)
Pw, _ = world(tg, c)
fr = Pw[:, tg.i('foot_r')]; fl = Pw[:, tg.i('foot_l')]
kmax = int(np.argmax(fr[:, 1]));
lift = contact('foot_r', 'foot_r', (max(0, kmax - 6) / FPS, min(len(fr) - 1, kmax + 6) / FPS), [0, float(fr[kmax, 1]) - 0.1, float(rm[kmax, 1]) if rm is not None else 0.0],
               [0, 1, 0], 'obstacle_top', [0.15, 0.5], {'distance': [0.6, 1.1, 1.6], 'facing': [0, 0, 1]}, hold=False,
               note='clearance: foot passes over the obstacle top at this moment (point = foot height - 0.1 = max obstacle height). Scale the root curve so this lines up with the obstacle.', space='start')
add('step_over', c, False, {'cmu': '141_09 Step Over', 'window_s': [0, 1.93]}, CMU_LIC, [lift], tags=['traverse', 'obstacle'], rm=rm,
    notes='walking step over; root motion ~%.1f m forward (apply the rootMotion curve to the character controller)' % (rm[-1, 1] if rm is not None else 0),
    extra={'footContacts': segs})

# cold shiver loop (hugging self) + periodic tremor layer
c = mocap('79_68', 1.2, 9.0)
despike(c); extract_root_motion(tg, c); lock_feet(tg, c)
d, i, j = find_loop(c, tg, 0, 30, len(c['times']) - 60, len(c['times']) - 1)
c = trim(c, i, j); make_loop(tg, c)
add_noise_layer(tg, c, ['spine_03', 'clavicle_l', 'clavicle_r', 'Head', 'lowerarm_l', 'lowerarm_r'], 1.1, 7.5)
add('cold_shiver_loop', c, True, {'cmu': '79_68 cold', 'window_s': [1.2 + i / FPS, 1.2 + j / FPS]}, CMU_LIC, tags=['idle', 'weather'],
    notes='arms hugging the torso + 7.5 Hz loop-safe tremor layer (authored) on spine/shoulders/head')

# both hands leaning on a waist-high surface (rock / crate / table) - loop
c = mocap('22_18', 1.2, 4.0)
despike(c); extract_root_motion(tg, c); lock_feet(tg, c)
d, i, j = find_loop(c, tg, 0, 15, len(c['times']) - 20, len(c['times']) - 1)
c = trim(c, i, j); make_loop(tg, c)
cs = []
for s in 'lr':
    Pw, _ = world(tg, c); h = Pw[:, tg.i('hand_' + s)]
    two_bone_ik(tg, c, ('upperarm_' + s, 'lowerarm_' + s, 'hand_' + s), np.repeat(h.mean(0)[None], len(h), 0))
    pp = palm_point(c, s, len(c['times']) // 2)
    cs.append(contact('hand_' + s, 'hand_' + s, (0, c['times'][-1]), [pp[0], pp[1] - SURF_OFF['hand'], pp[2]], [0, 1, 0], 'ledge_top', [pp[1] - 0.2, pp[1] + 0.15],
                      approach_for([0, 0, pp[2]], [0, 0, -1]), note='palm on top of a waist-high surface; runtime IK raises/lowers hands to the real top'))
add('lean_hands_ledge_loop', c, True, {'cmu': '22_18 leans with hands on high stool', 'window_s': [1.2 + i / FPS, 1.2 + j / FPS]}, CMU_LIC, cs,
    tags=['lean', 'contact', 'rest'], notes='both palms on a surface ~0.7 m high, ~0.45 m ahead; weight forward')

# catch balance: stumble (104_13) blended into a settle (105_59)
def compose(a, b, blend_s=0.3):
    """crossfade clip a -> b; b is re-rooted onto a's pelvis heading at the blend start"""
    nb = int(blend_s * FPS); Fa = len(a['times'])
    Pa, Qa = world(tg, a); Pb, Qb = world(tg, b)
    ip = tg.i('pelvis'); k = Fa - nb
    ya = yaw_of(Qa[k, ip]); yb = yaw_of(Qb[0, ip])
    q = qaxis([0, 1, 0], ya - yb)
    # re-root b: rotate its world pelvis about b's start pelvis, then move onto a's pelvis xz
    newP = qrot(np.repeat(q[None], len(b['times']), 0), Pb[:, ip] - Pb[0, ip] * np.array([1, 0, 1])) + Pa[k, ip] * np.array([1, 0, 1])
    b = dict(b); b['R'] = b['R'].copy(); b['T'] = b['T'].copy()
    newQ = qmul(np.repeat(q[None], len(b['times']), 0), Qb[:, ip])
    p = tg.sk.parent[ip]
    b['R'][:, ip] = qmul(qinv(Qb[:, p]), newQ); b['T'][:, ip] = qrot(qinv(Qb[:, p]), newP - Pb[:, p])
    F = Fa + len(b['times']) - nb
    R = np.zeros((F,) + a['R'].shape[1:]); T = np.zeros((F,) + a['T'].shape[1:])
    R[:k] = a['R'][:k]; T[:k] = a['T'][:k]
    for f in range(nb):
        u = (f + 0.5) / nb; u = u * u * (3 - 2 * u)
        R[k + f] = qslerp(a['R'][k + f], b['R'][f], np.full(a['R'].shape[1], u)); T[k + f] = a['T'][k + f] * (1 - u) + b['T'][f] * u
    R[Fa:] = b['R'][nb:]; T[Fa:] = b['T'][nb:]
    return dict(times=np.arange(F) / FPS, T=T, R=R, fps=FPS)

c = compose(mocap('104_13', 0.2, 1.5), mocap('105_59', 1.35, 2.55), 0.3)
ground_fix(tg, c); c, rm, segs = finish_mocap(c, travel=True)
add('catch_balance', c, False, {'cmu': '104_13 StumbleWalk [0.2-1.5 s] -> 105_59 360 smallStumble [1.35-2.55 s], 0.3 s crossfade'}, CMU_LIC,
    tags=['balance', 'reaction'], rm=rm, notes='trip forward, arms fly out, regain balance; small forward drift in rootMotion', extra={'footContacts': segs})

c = compose(mocap('90_17', 1.4, 2.65), mocap('105_59', 1.3, 2.55), 0.3)
ground_fix(tg, c); c, rm, segs = finish_mocap(c, travel=True)
add('slip_recover', c, False, {'cmu': '90_17 BannanaPeelSlip [1.4-2.65 s, before the fall] -> 105_59 [1.3-2.55 s] recovery, 0.3 s crossfade'}, CMU_LIC,
    tags=['balance', 'ice', 'reaction'], rm=rm, notes='foot shoots forward on ice, arms windmill, recover to stand (no fall). Trigger on ice when speed > ~2 m/s and turning/stopping hard',
    extra={'footContacts': segs})

# reach up & brush aside (right) + mirror
c, rm, _ = finish_mocap(mocap('144_24', 0.45, 2.15))
Pw, _ = world(tg, c); hr = Pw[:, tg.i('hand_r')]; kmx = int(np.argmax(hr[:, 1]))
g = contact('hand_r', 'hand_r', (max(0, kmx - 5) / FPS, min(len(hr) - 1, kmx + 8) / FPS), hr[kmx], [0, -0.3, -1], 'branch', [1.2, 1.9],
            {'distance': [0.2, 0.45, 0.8], 'facing': [0, 0, 1], 'lateral': round(float(hr[kmx, 0]), 3)}, hold=False,
            note='sweep contact: hand passes through this point; attach the branch tip to hand_r for the window then release (spring back)')
add('reach_branch_r', c, False, {'cmu': '144_24 Reach_Right', 'window_s': [0.45, 2.15]}, CMU_LIC, [g], tags=['reach', 'vegetation'], rm=rm,
    notes='reach up-right, catch and push a branch aside, return')
gl = dict(g, effector='hand_l', bone='hand_l', surface=dict(g['surface'], point=[-g['surface']['point'][0]] + g['surface']['point'][1:]), approach=dict(g['approach'], lateral=-g['approach']['lateral']))
add('reach_branch_l', mirror(tg, c), False, {'cmu': '144_24 (mirrored)'}, CMU_LIC, [gl], tags=['reach', 'vegetation'], notes='mirror of reach_branch_r')

# ================================================================== UAL (CC0)
print('ual')
c = ual_clip(W + '/src/UAL1_Standard_RM.glb', 'Push_Loop')
ground_fix(tg, c, pct=0.5); lock_feet(tg, c); rm = extract_root_motion(tg, c)
make_loop(tg, c)
cs = []
Pw, Qw = world(tg, c)
for s in 'lr':
    pp = palm_point(c, s, len(c['times']) // 2)
    cs.append(contact('hand_' + s, 'hand_' + s, (0, c['times'][-1]), [pp[0], pp[1], pp[2] + SURF_OFF['hand']], [0, 0, -1], 'object_face', [0.8, 1.5],
                      approach_for([0, 0, pp[2] + SURF_OFF['hand']], [0, 0, -1]), note='palms on the object face; move the object with the rootMotion speed'))
spd = float(np.linalg.norm(rm[-1, :2]) / c['times'][-1]) if rm is not None else 0
add('push_heavy_loop', c, True, {'ual': 'UAL1 Standard Push_Loop (root-motion variant)'}, UAL_LIC, cs, tags=['push', 'contact'],
    notes='walk-push cycle; native speed %.2f m/s (scale timeScale = v/that). rootMotion curve = one cycle' % spd, rm=None,
    extra={'locomotion': {'speed': round(spd, 3), 'cycle': round(float(c['times'][-1]), 3), 'rootMotionCycle': [[round(float(x), 4) for x in r] for r in (rm[::2] if rm is not None else [])]}})

# ================================================================== AUTHORED (key poses + IK over UAL idle)
print('authored')
IN = 0.6; LOOP = 2.5   # _in duration; loop = exactly one Idle_Loop period -> seamless

def split_in_loop(name, c, meta_fn, src, tags, notes, base_name='Idle_Loop'):
    n_in = int(IN * FPS)
    ci = trim(c, 0, n_in); cl = trim(c, n_in, n_in + int(LOOP * FPS))
    cs_in, cs_loop = meta_fn(c, n_in)
    add(name + '_in', ci, False, src, AUTH_LIC, cs_in, tags=tags, notes='enter (play reversed / crossfade to idle to exit). ' + notes)
    add(name + '_loop', cl, True, src, AUTH_LIC, cs_loop, tags=tags, notes='hold loop. ' + notes)

def ramp(v0, v1, t0=0.0, t1=IN, hold_to=IN + LOOP):
    return [(t0, v0), (t1, v1), (hold_to, v1)]

def hand_wall(sides, Zw=0.45, y=1.30, spread=0.21):
    keys = {'spine': ramp([0, 0, 0], [7 if len(sides) == 2 else 5, 0, 0]), 'neck': ramp([0, 0, 0], [6, 0, 0]),
            'pelvis_off': ramp([0, 0, 0], [0, -0.01, -0.02 if len(sides) == 2 else 0])}
    for s in sides:
        sg = 1 if s == 'l' else -1
        x = sg * (spread if len(sides) == 2 else 0.19)
        keys['hand_' + s] = ramp([x, y, Zw - 0.04], [x, y, Zw - 0.04])
        keys['hand_%s_w' % s] = [(0, 0), (IN * 0.85, 1), (IN + LOOP, 1)]
        keys['palm_' + s] = ramp([0, 0, 1], [0, 0, 1]); keys['fingers_' + s] = ramp([-sg * 0.2, 1, 0], [-sg * 0.2, 1, 0])
        keys['elbow_' + s] = ramp([sg * 0.7, -0.6, -0.2], [sg * 0.7, -0.6, -0.2])
    if len(sides) == 1:   # weight shift toward the supporting side
        s = sides[0]; sg = 1 if s == 'l' else -1
        keys['pelvis_off'] = ramp([0, 0, 0], [sg * 0.025, -0.01, 0]); keys['spine'] = ramp([0, 0, 0], [5, sg * 6, -sg * 3])
    c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], IN + LOOP), keys)
    def meta(c, n_in):
        out_in, out_loop = [], []
        for s in sides:
            pp = palm_point(c, s, n_in + 10); pt = [pp[0], pp[1], pp[2] + SURF_OFF['hand']]
            ap = approach_for(pt, [0, 0, -1])
            d = contact('hand_' + s, 'hand_' + s, (IN * 0.85, IN), pt, [0, 0, -1], 'wall', [y - 0.35, y + 0.3], ap,
                        note='palm flat on a vertical-ish face; IK target = raycast from shoulder along facing; clamp to heightRange')
            out_in.append(d); out_loop.append(dict(d, window=[0, LOOP]))
        return out_in, out_loop
    return c, meta

for sides, nm in ((('r',), 'hand_wall_r'), (('l',), 'hand_wall_l'), (('l', 'r'), 'hand_wall_both')):
    c, meta = hand_wall(sides)
    split_in_loop(nm, c, meta, {'authored': 'hand-on-wall key poses + arm IK', 'base': 'UAL Idle_Loop'}, ['contact', 'wall', 'rock'],
                  'rock/wall face 0.45 m ahead (range in approach); palm height 1.3 m')

# lean with shoulder against a wall on the character's right (mirror -> left)
def lean_shoulder(side):
    sg = 1 if side == 'l' else -1   # wall on +X for left
    th = 11.0
    keys = {'pelvis_rot': ramp([0, 0, 0], [0, 0, -sg * th]), 'pelvis_off': ramp([0, 0, 0], [sg * 0.92 * np.sin(th * DEG), -0.025, 0]),
            'spine': ramp([0, 0, 0], [2, 0, sg * 2]), 'neck': ramp([0, 0, 0], [0, -sg * 8, sg * 7]),
            'foot_l': None}
    del keys['foot_l']
    c = author(tg, base_from(tg, FOLD['T'], FOLD['R'], IN + LOOP), keys)
    def meta(c, n_in):
        Pw, _ = world(tg, c)
        sh = Pw[n_in + 5, tg.i('upperarm_' + side)]
        pt = [sh[0] + sg * SURF_OFF['shoulder'], sh[1], sh[2]]; nrm = [-sg, 0, 0]
        d = contact('shoulder_' + side, 'upperarm_' + side, (IN * 0.9, IN), pt, nrm, 'wall', [1.1, 1.9], approach_for(pt, nrm, (0.05, 0.05)),
                    note='outer shoulder touches the wall; body inclined %d deg, feet planted. Runtime: rotate the character so its side faces the wall at approach distance' % th)
        return [d], [dict(d, window=[0, LOOP])]
    return c, meta

for side in 'rl':
    c, meta = lean_shoulder(side)
    split_in_loop('lean_shoulder_' + side, c, meta, {'authored': 'shoulder lean key poses + leg IK', 'base': 'UAL Idle_FoldArms_Loop (hermit)'},
                  ['contact', 'wall', 'lean', 'rest'], 'arms folded')

# lean back against a wall
def lean_back():
    th = 9.0; fz = 0.32
    keys = {'foot_l': None}; del keys['foot_l']
    Pw0, _ = world(tg, base_from(tg, FOLD['T'], FOLD['R'], IN + LOOP))
    for s in 'lr':
        f0 = Pw0[:, tg.i('foot_' + s)]
        keys['foot_' + s] = [(0, f0[0]), (IN * 0.7, f0[0] + [0, 0, fz]), (IN + LOOP, f0[0] + [0, 0, fz])]
    keys['pelvis_rot'] = ramp([0, 0, 0], [-th, 0, 0])
    keys['pelvis_off'] = ramp([0, 0, 0], [0, -0.05, fz - 0.92 * np.sin(th * DEG)])
    keys['neck'] = ramp([0, 0, 0], [th + 3, 0, 0]); keys['spine'] = ramp([0, 0, 0], [-1, 0, 0])
    c = author(tg, base_from(tg, FOLD['T'], FOLD['R'], IN + LOOP), keys)
    def meta(c, n_in):
        Pw, _ = world(tg, c)
        b = Pw[n_in + 5, tg.i('spine_03')]
        pt = [0, b[1], b[2] - SURF_OFF['back']]; nrm = [0, 0, 1]
        d = contact('back', 'spine_03', (IN * 0.9, IN), pt, nrm, 'wall', [1.0, 2.2], approach_for(pt, nrm, (0.04, 0.06)),
                    note='upper back on the wall, feet %.2f m forward. Runtime: face away from the wall, place origin at approach distance' % fz)
        return [d], [dict(d, window=[0, LOOP])]
    return c, meta

c, meta = lean_back()
split_in_loop('lean_back', c, meta, {'authored': 'back lean key poses + leg IK', 'base': 'UAL Idle_FoldArms_Loop (hermit)'}, ['contact', 'wall', 'lean', 'rest'], 'arms folded')

# brace on a slope with one hand
def brace(side):
    sg = 1 if side == 'l' else -1
    slope = 32 * DEG; n = np.array([0, np.cos(slope), -np.sin(slope)])
    base = base_from(tg, IDLE['T'], IDLE['R'], IN + LOOP)
    Pw0, _ = world(tg, base)
    lead = 'l' if side == 'r' else 'r'
    f0 = Pw0[0, tg.i('foot_' + lead)]
    keys = {'pelvis_off': ramp([0, 0, 0], [0, -0.13, -0.04]), 'pelvis_rot': ramp([0, 0, 0], [12, 0, 0]),
            'spine': ramp([0, 0, 0], [32, sg * 6, 0]), 'neck': ramp([0, 0, 0], [-34, 0, 0]),
            'hand_' + side: ramp([sg * 0.17, 0.70, 0.46], [sg * 0.17, 0.70, 0.46]), 'hand_%s_w' % side: [(0, 0), (IN * 0.8, 1), (IN + LOOP, 1)],
            'palm_' + side: ramp(list(-n), list(-n)), 'fingers_' + side: ramp([0, np.sin(slope), np.cos(slope)], [0, np.sin(slope), np.cos(slope)]),
            'elbow_' + side: ramp([sg * 0.6, -0.3, -0.5], [sg * 0.6, -0.3, -0.5]),
            'foot_' + lead: [(0, f0), (IN * 0.7, f0 + [0, 0.17, 0.30]), (IN + LOOP, f0 + [0, 0.17, 0.30])],
            'foot_%s_rot' % lead: ramp(0, -26), 'knee_' + lead: ramp([0, 0.3, 1], [0, 0.3, 1])}
    c = author(tg, base, keys)
    def meta(c, n_in):
        pp = palm_point(c, side, n_in + 5); pt = pp - n * SURF_OFF['hand']
        d = contact('hand_' + side, 'hand_' + side, (IN * 0.8, IN), pt, n, 'slope', [0.35, 0.95], {'distance': [0.4, round(float(pt[2]), 3), 0.8], 'facing': [0, 0, 1]},
                    note='palm on rising ground (~32 deg) ahead; lead foot %s planted 0.17 m higher, 0.3 m ahead. Runtime: raycast down in front of the shoulder, orient palm to the hit normal' % lead)
        f = contact('foot_' + lead, 'foot_' + lead, (IN * 0.7, IN), [f0[0], 0.17 - 0.1, 0.30], n, 'slope', [0.0, 0.35], {'distance': [0.2, 0.3, 0.45], 'facing': [0, 0, 1]})
        return [d, f], [dict(d, window=[0, LOOP]), dict(f, window=[0, LOOP])]
    return c, meta

for side in 'rl':
    c, meta = brace(side)
    split_in_loop('brace_slope_' + side, c, meta, {'authored': 'slope brace key poses + arm/leg IK', 'base': 'UAL Idle_Loop'}, ['contact', 'slope', 'climb'],
                  'one hand braced on a steep slope while climbing/pausing')

# tired: hands on knees (heavy breathing) + standing heavy breathing
def breath_keys(amp, dur, cycles, phase=0.0, base=0.0):
    ts = np.linspace(0, dur, int(dur * FPS) + 1)
    return [(t, base + amp * np.sin(2 * np.pi * cycles * t / dur + phase)) for t in ts]

L2 = LOOP * 1.0
sp = breath_keys(3.0, L2, 2); cl_ = breath_keys(4.0, L2, 2, -0.6, 3.0)
keys = {'pelvis_off': [(0, [0, -0.11, -0.10])], 'pelvis_rot': [(0, [16, 0, 0])],
        'spine': [(t, [28 + v, 0, 0]) for t, v in sp], 'neck': [(0, [-32, 0, 0])],
        'clav_l': cl_, 'clav_r': cl_}
for s, sg in (('l', 1), ('r', -1)):
    keys['hand_' + s] = [(0, [sg * 0.13, 0.60, 0.17])]; keys['hand_%s_w' % s] = [(0, 1.0)]
    keys['palm_' + s] = [(0, [0, -1, -0.15])]; keys['fingers_' + s] = [(0, [-sg * 0.25, -0.2, 1])]; keys['elbow_' + s] = [(0, [sg * 0.8, 0, -0.4])]
    keys['flat_' + s] = [(0, 0.6)]
c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], L2), keys)
cs = []
for s in 'lr':
    pp = palm_point(c, s, 10) - np.array([0, 1.0, 0]) * SURF_OFF['hand']
    cs.append(contact('hand_' + s, 'hand_' + s, (0, L2), pp, [0, 1, 0], 'own_thigh', [0.45, 0.7], {'distance': [0, 0, 0], 'facing': [0, 0, 1]}, note='self contact (no world IK)'))
add('tired_hands_knees_loop', c, True, {'authored': 'bent over, hands on knees, 0.8 Hz heavy breathing', 'base': 'UAL Idle_Loop'}, AUTH_LIC, cs, tags=['idle', 'tired'],
    notes='after sprint / climb; 2 breaths per 2.5 s loop')

keys = {'spine': [(t, [6 + v, 0, 0]) for t, v in breath_keys(2.2, L2, 2)], 'neck': [(0, [14, 0, 0])],
        'clav_l': breath_keys(5.0, L2, 2, -0.6, 2.0), 'clav_r': breath_keys(5.0, L2, 2, -0.6, 2.0), 'pelvis_off': [(0, [0, -0.015, 0])]}
c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], L2), keys)
add('tired_breath_loop', c, True, {'authored': 'standing heavy breathing layer', 'base': 'UAL Idle_Loop'}, AUTH_LIC, [], tags=['idle', 'tired'],
    notes='upright, head down, shoulders heave 0.8 Hz')

# look-around idle (5 s = 2 idle periods)
L5 = 2 * LOOP
yaw = [(0, 0), (0.7, 0), (1.5, 55), (2.3, 55), (3.3, -50), (4.1, -50), (L5, 0)]
keys = {'neck': [(t, [-4 if abs(v) > 1 else 0, v * 0.7, 0]) for t, v in yaw], 'spine': [(t, [0, v * 0.3, 0]) for t, v in yaw]}
c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], L5), keys)
add('look_around_loop', c, True, {'authored': 'head/torso scan left-right', 'base': 'UAL Idle_Loop'}, AUTH_LIC, [], tags=['idle'],
    notes='scan +55 deg left, -50 deg right; head yaw ~0.7, torso ~0.3 of the look angle')

# point forward (right arm)
DUR = 2.2
keys = {'hand_r': [(0, [-0.24, 1.40, 0.46]), (DUR, [-0.24, 1.40, 0.46])], 'hand_r_w': [(0, 0), (0.45, 1), (1.45, 1), (2.0, 0), (DUR, 0)],
        'palm_r': [(0, [0.3, -1, 0])], 'fingers_r': [(0, [-0.12, 0.05, 1])], 'elbow_r': [(0, [-0.6, -0.8, 0])], 'flat_r': [(0, 0.0)],
        'spine': [(0, [0, 0, 0]), (0.45, [0, -6, 0]), (1.45, [0, -6, 0]), (2.0, [0, 0, 0])], 'neck': [(0, [0, 0, 0]), (0.45, [2, -4, 0]), (1.45, [2, -4, 0]), (2.0, [0, 0, 0])]}
c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], DUR), keys)
# index finger straight, others stay curled (idle)
w = np.clip(interp_keys(keys['hand_r_w'], c['times'], 1), 0, 1)
for nm in ('index_01_r', 'index_02_r', 'index_03_r'):
    i = tg.i(nm); c['R'][:, i] = qslerp(c['R'][:, i], np.repeat(tg.sk.R[i][None], len(w), 0), w)
for nm in ('middle', 'ring', 'pinky'):
    for k in ('01', '02', '03'):
        i = tg.i('%s_%s_r' % (nm, k));
        cur = c['R'][:, i]; extra = qaxis(np.repeat([[1, 0, 0.0]], len(w), 0), w * 55 * DEG)
        c['R'][:, i] = qmul(cur, extra)
add('point_r', c, False, {'authored': 'arm IK point', 'base': 'UAL Idle_Loop'}, AUTH_LIC, [], tags=['gesture'],
    notes='points straight ahead at shoulder height; hold phase 0.45-1.45 s. For a target: drive the arm IK layer with the direction, keep the finger pose',
    extra={'gesture': {'effector': 'hand_r', 'aimAxis': 'index finger', 'hold': [0.45, 1.45]}})
# mirror
add('point_l', mirror(tg, c), False, {'authored': 'mirror of point_r'}, AUTH_LIC, [], tags=['gesture'], notes='mirror of point_r',
    extra={'gesture': {'effector': 'hand_l', 'aimAxis': 'index finger', 'hold': [0.45, 1.45]}})

# vault over a ~1 m obstacle (two-hand plant, legs tuck through to the left side, land, stand)
H = 1.0; Z0 = 0.62; DEP = 0.40   # obstacle front face z, top height, depth
Tv = 1.6
base = base_from(tg, IDLE['T'], IDLE['R'], Tv)
Pw0, _ = world(tg, base); pel0 = Pw0[0, tg.i('pelvis')]; fl0 = Pw0[0, tg.i('foot_l')]; fr0 = Pw0[0, tg.i('foot_r')]
def P(x, y, z): return [x - pel0[0], y - pel0[1], z - pel0[2]]
keys = {
    'pelvis_off': [(0, P(0, pel0[1], 0)), (0.22, P(0, 0.80, 0.18)), (0.40, P(0.02, 1.06, 0.46)), (0.52, P(-0.04, 1.28, 0.72)),
                   (0.66, P(-0.03, 1.24, 1.05)), (0.82, P(-0.02, 1.04, 1.36)), (0.98, P(0, 0.74, 1.52)), (1.25, P(0, 0.86, 1.62)), (Tv, P(0, pel0[1], 1.64))],
    'pelvis_rot': [(0, [0, 0, 0]), (0.22, [18, 0, 0]), (0.40, [30, 0, 0]), (0.52, [38, -20, 8]), (0.66, [20, -10, 4]), (0.82, [8, 0, 0]), (0.98, [22, 0, 0]), (1.25, [8, 0, 0]), (Tv, [0, 0, 0])],
    'spine': [(0, [0, 0, 0]), (0.22, [18, 0, 0]), (0.40, [30, 0, 0]), (0.52, [34, 8, 0]), (0.66, [20, 4, 0]), (0.82, [10, 0, 0]), (0.98, [20, 0, 0]), (1.25, [6, 0, 0]), (Tv, [0, 0, 0])],
    'neck': [(0, [0, 0, 0]), (0.22, [-18, 0, 0]), (0.40, [-24, 0, 0]), (0.52, [-26, 0, 0]), (0.66, [-14, 0, 0]), (0.82, [-8, 0, 0]), (0.98, [-15, 0, 0]), (Tv, [0, 0, 0])],
    'foot_l': [(0, fl0), (0.18, fl0 + [0, 0, 0.30]), (0.30, fl0 + [0, 0, 0.30]), (0.46, [0.20, 0.72, 0.40]), (0.58, [0.14, H + 0.12, Z0 + 0.18]), (0.68, [0.12, H + 0.06, Z0 + 0.42]),
               (0.80, [0.10, 0.60, 1.34]), (0.92, fl0 * [1, 1, 0] + [0, 0, 1.58]), (Tv, fl0 * [1, 1, 0] + [0, 0, 1.64])],
    'foot_r': [(0, fr0), (0.26, fr0 + [0, 0, 0.12]), (0.36, fr0 + [0, 0, 0.12]), (0.50, [0.02, 0.80, 0.42]), (0.61, [0.05, H + 0.10, Z0 + 0.14]), (0.71, [0.02, H + 0.05, Z0 + 0.40]),
               (0.84, [-0.08, 0.55, 1.40]), (0.96, fr0 * [1, 1, 0] + [0, 0, 1.66]), (Tv, fr0 * [1, 1, 0] + [0, 0, 1.64])],
    'knee_l': [(0, [0, 0, 1]), (0.5, [0.3, 0.5, 1]), (0.8, [0, 0, 1])], 'knee_r': [(0, [0, 0, 1]), (0.5, [0, 0.5, 1]), (0.8, [0, 0, 1])],
    'foot_l_rot': [(0, 0), (0.42, 0), (0.55, 30), (0.72, 20), (0.86, 0)], 'foot_r_rot': [(0, 0), (0.46, 0), (0.60, 30), (0.76, 20), (0.90, 0)],
}
for s, sg in (('l', 1), ('r', -1)):
    hp = [sg * 0.2, H + 0.035, Z0 + 0.14]
    keys['hand_' + s] = [(0, hp), (Tv, hp)]
    keys['hand_%s_w' % s] = [(0, 0), (0.08, 0), (0.36, 1), (0.45 if s == 'l' else 0.47, 1), (0.58 if s == 'l' else 0.62, 0), (Tv, 0)]
    keys['palm_' + s] = [(0, [0, -1, 0])]; keys['fingers_' + s] = [(0, [-sg * 0.3, 0, 1])]; keys['elbow_' + s] = [(0, [sg * 0.8, 0, -0.5])]
c = author(tg, base, keys)
if os.environ.get('DBG'):
    Pw, _ = world(tg, c)
    for s in 'lr':
        hk = interp_keys(keys['hand_' + s], c['times'], 3); w = interp_keys(keys['hand_%s_w' % s], c['times'], 1)
        d = np.linalg.norm(Pw[:, tg.i('upperarm_' + s)] - hk, axis=-1); e = np.linalg.norm(Pw[:, tg.i('hand_' + s)] - hk, axis=-1)
        print('DBG', s, [(round(t, 2), round(x, 2), round(y, 2)) for t, x, y, ww in zip(c['times'], d, e, w) if ww > 0.9])
ft = {s: interp_keys(keys['foot_' + s], c['times'], 3) for s in 'lr'}
rm = extract_root_motion(tg, c)
cs = []
for s, t1 in (('l', 0.45), ('r', 0.47)):
    cs.append(contact('hand_' + s, 'hand_' + s, (0.36, t1), [(0.2 if s == 'l' else -0.2), H, Z0 + 0.14], [0, 1, 0], 'obstacle_top', [0.8, 1.2],
                      {'distance': [0.45, Z0, 0.85], 'facing': [0, 0, 1]}, hold=True,
                      note='palm plant on the top edge; runtime: scale the vertical keys by (real top / 1.0) and pin hands to the hit point', space='start'))
add('vault_1m', c, False, {'authored': 'two-hand plant vault over a 1.0 m x 0.4 m obstacle, legs tuck through', 'base': 'UAL Idle_Loop'}, AUTH_LIC, cs,
    tags=['traverse', 'obstacle', 'vault'], rm=rm,
    notes='obstacle front face 0.62 m ahead, top 1.0 m, depth 0.4 m; lands 1.64 m ahead. Hand-keyed (no mocap source fits a 1 m vault) - readable but less organic than mocap',
    extra={'obstacle': {'frontZ': Z0, 'top': H, 'depth': DEP}})

# ------------------------------------------------------------------ write
extras = {'skeleton': 'Quaternius UAL (65 joints), identical rest on pilot_aces(_textured) and npc_hermit', 'units': 'metres, pilot native (1.90 m tall); glTF +Y up, character faces +Z',
          'generator': 'tools/anim/build_pilot.py'}
size = write_clips(OUT + '/anim_pilot_contact.glb', tg, [(n, c, {'loop': m['loop']}) for n, c, m in LIB], extras)
meta = {'version': 1, 'skeleton': extras['skeleton'], 'units': extras['units'], 'clips': {m['name']: m for _, _, m in LIB}}
json.dump(meta, open(OUT + '/anim_pilot_contact.meta.json', 'w'), indent=1)
print('wrote', len(LIB), 'clips', size, 'bytes')
