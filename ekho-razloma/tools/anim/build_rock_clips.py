"""Rock-interaction clips for the pilot (UAL skeleton), APPENDED to the existing contact library without re-building it.
usage: python3.11 build_rock_clips.py <workdir>
  workdir: pilot_aces_textured.glb, npz/{13_04,111_26}.npz (tools/anim/fbx_dump.py on CMU FBX), anim_pilot_contact.glb
           (unpacked from assets/pack/anim_pilot_contact.js) + anim_pilot_contact.meta.json
writes <workdir>/out/anim_pilot_contact.glb + .meta.json = the old 37 clips byte-for-byte + the new ones below
  sit_rock_in / _loop / _out            CMU 13_04 (sit on stepstool, source seat 0.33 m), pelvis raised 0.10: seat 0.43 m
  sit_rock_high_in / _loop / _out       same motion, pelvis raised 0.27, feet re-pinned to the ground: seat 0.60 m
  touch_walk_r / touch_walk_l           authored arm layer (clavicle..fingers tracks only): palm sliding along a side wall
  squeeze_side_r_in / _loop (+ _l)      CMU 111_26 (walk sideways) legs + authored arms: side-step through a 0.6-1 m gap
"""
import sys, os, json, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import retarget as RT
from retarget import *
from author import *

W = sys.argv[1]
OUT = os.path.join(W, 'out'); os.makedirs(OUT, exist_ok=True)
tg = Target(W + '/pilot_aces_textured.glb')
FPS = 30.0
CMU_LIC = 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu) - free for all uses incl. commercial; FBX via cgspeed BVH / gbionics/cmu-fbx'
AUTH_LIC = 'authored for this project (key poses + IK on the UAL skeleton, UAL Idle base CC0) - same license as the game'
SURF_OFF = {'hand': 0.035, 'seat': 0.10, 'back': 0.16}
NEW = []   # (name, clip, meta)
MASK = {}  # clip name -> set of joint indices that get tracks (arm layers)

def ual_idle():
    sk = Skeleton(*read_glb(W + '/pilot_aces_textured.glb')); ai = sk.anim_names().index('Idle_Loop')
    ts, T, R = sk.sample(ai, FPS)
    Tl = np.repeat(tg.sk.T[None], len(ts), 0).copy(); Rl = np.repeat(tg.sk.R[None], len(ts), 0).copy()
    for i, nm in enumerate(tg.sk.names):
        if nm in sk.idx and nm not in ('Armature', 'root'): Rl[:, i] = R[:, sk.idx[nm]]
    Pw, Qw = sk.fk(T, R); ip = sk.idx['pelvis']
    c = dict(times=ts - ts[0], T=Tl, R=Rl, fps=FPS)
    Pt, Qt = world(tg, c); jp = tg.i('pelvis'); par = tg.sk.parent[jp]
    c['R'][:, jp] = qmul(qinv(Qt[:, par]), Qw[:, ip]); c['T'][:, jp] = qrot(qinv(Qt[:, par]), Pw[:, ip] - Pt[:, par])
    return c
IDLE = ual_idle()

def contact(effector, bone, window, point, normal, surface, height_range, approach, hold=True, blend=(0.15, 0.2), note=None, space='character'):
    n = np.asarray(normal, float); n = n / np.linalg.norm(n)
    d = {'effector': effector, 'bone': bone, 'window': [round(float(window[0]), 3), round(float(window[1]), 3)],
         'blendIn': blend[0], 'blendOut': blend[1], 'hold': hold, 'surface': {'type': surface, 'point': [round(float(x), 3) for x in point], 'normal': [round(float(x), 3) for x in n]},
         'heightRange': [round(float(x), 3) for x in height_range], 'approach': approach, 'space': space}
    if note: d['note'] = note
    return d

def approach_for(point, normal, slack=(0.08, 0.12)):
    n = np.array(normal, float); nh = n * np.array([1, 0, 1.0]); nh /= np.linalg.norm(nh)
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

def mocap(nm, t0, t1):
    src = load_src(f'{W}/npz/{nm}.npz')
    return retarget(tg, src, f0=max(1, int(round(t0 * src['fps']))), f1=int(round(t1 * src['fps'])), fps=FPS)

def reframe(c, yaw, origin):
    """whole clip: rotate about +Y by -yaw, then move `origin` (world xz) to the character origin"""
    Pw, Qw = world(tg, c); ip = tg.i('pelvis'); p = tg.sk.parent[ip]; F = len(c['times'])
    q = np.repeat(qaxis([0, 1, 0], -yaw)[None], F, 0)
    o = np.array([origin[0], 0, origin[1]])
    newP = qrot(q, Pw[:, ip] - o); newQ = qmul(q, Qw[:, ip])
    c['R'][:, ip] = qmul(qinv(Qw[:, p]), newQ); c['T'][:, ip] = qrot(qinv(Qw[:, p]), newP - Pw[:, p])
    return c

def pin_feet(c, targets, w=None, pole=None):
    """ankles to fixed world targets {side: [F,3]} (weights [F]); knees over the toes"""
    for s in 'lr':
        if s not in targets: continue
        Pw, Qw = world(tg, c)
        fwd = qrot(Qw[:, tg.i('pelvis')], np.array([0, 0, 1.0])) * np.array([1, 0, 1.0]) + np.array([0, 0.25, 1e-3])
        two_bone_ik(tg, c, ('thigh_' + s, 'calf_' + s, 'foot_' + s), targets[s], None if w is None else w, pole=fwd if pole is None else pole)

LEGS = None
def crossfade_to(c, pose_T, pose_R, t0, keep_legs=False):
    """blend the tail of c (from time t0) to a static pose (smoothstep) - used to land the stand-up on the idle stance.
    keep_legs: thighs/calves/feet keep their own rotations (the caller re-pins the feet, so they do not slide)"""
    ts = c['times']; F = len(ts)
    legs = [tg.i(n) for n in tg.sk.names if n.startswith(('thigh', 'calf', 'foot', 'ball'))] if keep_legs else []
    for f in range(F):
        if ts[f] < t0: continue
        u = (ts[f] - t0) / max(1e-6, ts[-1] - t0); u = u * u * (3 - 2 * u)
        keep = c['R'][f, legs].copy()
        c['R'][f] = qslerp(c['R'][f], pose_R, np.full(c['R'].shape[1], u)); c['T'][f] = c['T'][f] * (1 - u) + pose_T * u
        if legs: c['R'][f, legs] = keep
    return c

# ================================================================== SIT (CMU 13_04 sit on stepstool, hands on knees)
print('sit')
full = mocap('13_04', 1.6, 10.0); despike(full)
Pw, Qw = world(tg, full); ts = full['times']; ip = tg.i('pelvis')
fi = lambda t: int(round((t - 1.6) * FPS))
seatedYaw = float(np.mean(yaw_of(Qw[fi(4.6):fi(7.2), ip])))
feet0 = (Pw[fi(1.75), tg.i('foot_l')] + Pw[fi(1.75), tg.i('foot_r')]) / 2     # standing feet centre before the sit
reframe(full, seatedYaw, (feet0[0], feet0[2]))
# feet: the source's own steps (it steps out as it lowers, settles once, draws back to stand) but flat on the ground -
# the subject sat on a stepstool with the heels up on its rung; on a rock the soles rest on the snow
Pw, _ = world(tg, full)
ground = {s: float(tg.Pw[tg.i('foot_' + s), 1]) for s in 'lr'}
pel = Pw[:, ip]; stand0 = float(pel[0, 1]); seated0 = float(np.median(pel[fi(4.6):fi(7.2), 1]))
sit_u = np.clip((stand0 - pel[:, 1]) / (stand0 - seated0), 0, 1)
seat_x = float(np.median(pel[fi(4.6):fi(7.2), 0]))
tgt = {}; ARC = {}
for s in 'lr':
    f = Pw[:, tg.i('foot_' + s)].copy()
    lift = float(np.median(f[fi(4.6):fi(7.2), 1])) - ground[s]
    f[:, 1] = np.maximum(ground[s], f[:, 1] - lift * sit_u)
    f[:, 0] = seat_x + (f[:, 0] - seat_x) * 0.65          # the subject sat knees-wide (0.64 m between the feet): narrower stance
    # steps: the source slides the feet low over the floor as it settles / draws them back -> a real lift arc while moving
    v = np.linalg.norm(np.gradient(f[:, [0, 2]], axis=0), axis=-1) * FPS
    raw = np.clip((v - 0.12) / 0.4, 0, 1); arc = np.array([raw[max(0, k - 3):k + 4].max() for k in range(len(raw))])
    arc = np.convolve(arc, np.ones(5) / 5, 'same')
    f[:, 1] = np.maximum(f[:, 1], ground[s] + 0.08 * arc)
    tgt[s] = f; ARC[s] = arc
pin_feet(full, tgt)
# soles flat whenever the foot is down (source: heels up on the stool rung while seated); yaw of each foot kept
Pw, Qw = world(tg, full)
for s in 'lr':
    i = tg.i('foot_' + s); d = Pw[:, tg.i('ball_' + s)] - Pw[:, i]; yaw = np.arctan2(d[:, 0], d[:, 2])
    d0 = tg.Pw[tg.i('ball_' + s)] - tg.Pw[i]; yaw0 = np.arctan2(d0[0], d0[2])
    flat = qmul(qaxis(np.repeat([[0, 1, 0.0]], len(yaw), 0), yaw - yaw0), np.repeat(tg.Qw[i][None], len(yaw), 0))
    set_world_rot(tg, full, 'foot_' + s, flat, w=np.clip(1 - ARC[s] * 1.5, 0, 1))
lock_feet(tg, full)          # remaining plant slides -> pinned
# lock_feet pins the ball and lets the ankle roll: keep the (flat) ankle at least at its standing height
Pw, _ = world(tg, full)
pin_feet(full, {s: np.concatenate([Pw[:, tg.i('foot_' + s), :1], np.maximum(Pw[:, tg.i('foot_' + s), 1:2], ground[s]), Pw[:, tg.i('foot_' + s), 2:]], 1) for s in 'lr'})
Pw, _ = world(tg, full)
pel = Pw[:, ip]
SEAT_PEL = float(np.median(pel[fi(4.6):fi(7.2), 1])); SEAT_H = SEAT_PEL - SURF_OFF['seat']
seat_xz = np.median(pel[fi(4.6):fi(7.2)][:, [0, 2]], 0)
print('  seated pelvis %.3f -> seat %.3f, seat xz %s' % (SEAT_PEL, SEAT_H, seat_xz.round(3)))

def sit_parts(c, dh=0.0, name='sit_rock'):
    Pw, _ = world(tg, c); pel = Pw[:, ip].copy(); stand = pel[0, 1]
    if dh:
        # raise the pelvis in proportion to how far down it is (standing: 0, seated: dh), feet stay on the ground
        u = np.clip((stand - pel[:, 1]) / (stand - SEAT_PEL), 0, 1)
        feet = {s: Pw[:, tg.i('foot_' + s)].copy() for s in 'lr'}
        pel[:, 1] += dh * u
        # the higher seat: knees less bent, hips a bit forward so the feet stay under the knees
        pel[:, 2] += 0.05 * u
        set_world_pelvis(tg, c, pel); pin_feet(c, feet)
    a, b = fi(4.45), fi(7.3)
    c_in = trim(c, 0, a); c_loop = trim(c, a, b); c_out = trim(c, b, fi(8.85))
    d, i, j = find_loop(c_loop, tg, 0, 20, len(c_loop['times']) - 25, len(c_loop['times']) - 1)
    c_loop = trim(c_loop, i, j); make_loop(tg, c_loop)
    # stand-up ends on the idle stance so the crossfade to Idle/locomotion does not pop
    ft = {s: world(tg, c_out)[0][:, tg.i('foot_' + s)].copy() for s in 'lr'}
    crossfade_to(c_out, IDLE['T'][0], IDLE['R'][0], c_out['times'][-1] - 0.35, keep_legs=True)
    pin_feet(c_out, ft)
    Pl, _ = world(tg, c_loop); pz = float(np.median(Pl[:, ip, 2])); py = float(np.median(Pl[:, ip, 1]))
    seat = py - SURF_OFF['seat']
    fz = float(np.median(Pl[:, [tg.i('foot_l'), tg.i('foot_r')], 2]))
    edge = pz + 0.13           # front edge of the seat surface = under the back of the thighs, ~0.13 m ahead of the hip joint
    appr = {'distance': [round(-edge - 0.06, 3), round(-edge, 3), round(-edge + 0.08, 3)], 'facing': [0, 0, -1],
            'note': 'distance from the feet origin BACK to the seat front edge; the character faces AWAY from the rock'}
    def seat_c(window, hold=True):
        return contact('seat', 'pelvis', window, [0, seat, pz], [0, 1, 0], 'seat_top', [seat - 0.06, seat + 0.07], appr, hold=hold,
                       note='buttocks on a flat top %.2f m high, %.2f m behind the feet; feet %.2f m ahead of the hips. Runtime: stand with the back to the rock at approach distance; vertical IK only (pelvis ±6 cm)' % (seat, -pz, fz - pz))
    tin = c_in['times'][-1]
    src = {'cmu': '13_04 sit on stepstool, chin in hand (subject 13)', 'window_s': [1.6, 8.85]}
    note = 'seat %.2f m' % seat + ' (pelvis raised %.2f m over the %.2f m source seat, legs re-solved)' % (dh, SEAT_H)
    add(name + '_in', c_in, False, src, CMU_LIC, [seat_c((tin - 0.35, tin), True)], tags=['contact', 'rock', 'sit', 'rest'],
        notes='stand with the back to the rock -> sit down, settle the feet (%.1f s). %s' % (tin, note))
    add(name + '_loop', c_loop, True, src, CMU_LIC, [seat_c((0, c_loop['times'][-1]))], tags=['contact', 'rock', 'sit', 'rest'],
        notes='seated, forearms on the knees, slow breathing. %s' % note)
    add(name + '_out', c_out, False, src, CMU_LIC, [seat_c((0, 0.25), False)], tags=['contact', 'rock', 'sit', 'rest'],
        notes='lean forward, push up, stand (ends on the Idle stance). %s' % note)
    return seat

s_lo = sit_parts({k: (v.copy() if hasattr(v, 'copy') else v) for k, v in full.items()}, 0.10, 'sit_rock')
s_hi = sit_parts({k: (v.copy() if hasattr(v, 'copy') else v) for k, v in full.items()}, 0.27, 'sit_rock_high')
print('  seats', round(s_lo, 3), round(s_hi, 3))

# ================================================================== TOUCH WHILE WALKING (authored arm layer)
print('touch_walk')
ARM = lambda s: {tg.i(n) for n in tg.sk.names if n.endswith('_' + s) and any(k in n for k in ('clavicle', 'upperarm', 'lowerarm', 'hand', 'thumb', 'index', 'middle', 'ring', 'pinky'))}
TW = 2.0   # loop length; small bob at 2 Hz (about the walk step rate) - the palm trails and catches up on the rock texture
def touch_walk(side):
    sg = 1 if side == 'l' else -1       # wall on +X for the left hand
    ts = np.arange(int(TW * FPS) + 1) / FPS
    x = sg * 0.42; y0 = 1.20; z0 = 0.06
    keys = {}
    bob = [(t, [x, y0 + 0.025 * np.sin(2 * np.pi * 2 * t / TW * 2), z0 - 0.045 * np.sin(2 * np.pi * 2 * t / TW * 2 + 0.8)]) for t in ts[::3]]
    keys['hand_' + side] = bob; keys['hand_%s_w' % side] = [(0, 1.0)]
    keys['palm_' + side] = [(0, [sg, -0.05, 0])]                 # palm faces the wall
    keys['fingers_' + side] = [(0, [sg * 0.15, 0.35, 1])]         # fingers forward-up, leading along the wall
    keys['elbow_' + side] = [(0, [sg * 0.3, -0.9, -0.35])]
    keys['clav_' + side] = [(0, 6)]
    keys['flat_' + side] = [(0, 0.8)]
    c = author(tg, base_from(tg, IDLE['T'], IDLE['R'], TW), keys)
    make_loop(tg, c)
    Pw, _ = world(tg, c)
    hp = Pw[:, tg.i('hand_' + side)] + (Pw[:, tg.i('middle_01_' + side)] - Pw[:, tg.i('hand_' + side)]) * 0.6
    pp = hp.mean(0); pt = [pp[0] + sg * SURF_OFF['hand'], pp[1], pp[2]]
    print('  palm x %.3f..%.3f y %.2f..%.2f z %.2f..%.2f' % (hp[:, 0].min(), hp[:, 0].max(), hp[:, 1].min(), hp[:, 1].max(), hp[:, 2].min(), hp[:, 2].max()))
    d = contact('hand_' + side, 'hand_' + side, (0, TW), pt, [-sg, 0, 0], 'wall', [0.85, 1.45], dict(approach_for(pt, [-sg, 0, 0], (0.1, 0.12)), lateral=True),
                blend=(0.25, 0.3), note='palm slides along a wall on the character %s while walking (0.4-1.5 m/s). Runtime: raycast sideways from the shoulder each frame, IK the palm onto the hit; play over locomotion' % ('left' if sg > 0 else 'right'))
    MASK['touch_walk_' + side] = ARM(side)
    add('touch_walk_' + side, c, True, {'authored': 'side-wall palm slide, arm layer', 'base': 'UAL Idle_Loop (arm only)'}, AUTH_LIC, [d], tags=['contact', 'rock', 'wall', 'layer', 'walk'],
        notes='ARM LAYER: only clavicle/arm/hand/finger tracks of the %s side. three.js averages overlapping tracks by weight, so play it with a high weight (x3-4) over walk/jog, or pose the arm with it and let LimbIK do the rest' % ('left' if sg > 0 else 'right'),
        extra={'layer': {'mask': 'arm_' + side, 'bones': sorted(tg.sk.names[i] for i in MASK['touch_walk_' + side])}})
touch_walk('r'); touch_walk('l')

# ================================================================== SQUEEZE SIDEWAYS (CMU 111_26 walk sideways + authored arms)
print('squeeze')
c = mocap('111_26', 0.9, 4.8); despike(c)
ground_fix(tg, c, pct=1)
segs = lock_feet(tg, c)
rm = extract_root_motion(tg, c)        # travel (to the character's right, -X) -> root curve; clip in place, facing +Z
d, i, j = find_loop(c, tg, 0, 20, len(c['times']) - 30, len(c['times']) - 1)
loop = trim(c, i, j); rmL = rm[i:j + 1] - rm[i]; make_loop(tg, loop)
# a pure side-step: the source drifts forward and turns a little per cycle - remove the linear drift of z / yaw (loops never wander)
u = np.linspace(0, 1, len(rmL)); rmL[:, 1] -= u * rmL[-1, 1]; rmL[:, 2] -= u * rmL[-1, 2]
print('  loop %.2f s, travel %s' % (loop['times'][-1], rmL[-1].round(3)))
# chest to the front wall: shoulders narrow, pelvis a bit lower, face turned toward the travel, palms on the walls
Lt = loop['times'][-1]; FZ = 0.33; BZ = -0.36   # front wall / back wall z (character space) for a ~0.7 m gap
def squeeze_keys(sg, dur, ramp_t=None):
    """sg = -1: moving to the character's right (lead hand right). ramp_t: authored enter (0 -> 1 over ramp_t)"""
    lead, trail = ('r', 'l') if sg < 0 else ('l', 'r')
    k = {}
    R = (lambda v0, v1: [(0, v0), (ramp_t, v1), (dur, v1)]) if ramp_t else (lambda v0, v1: [(0, v1)])
    k['pelvis_off'] = R([0, 0, 0], [0, -0.05, -0.02]); k['spine'] = R([0, 0, 0], [3, 0, 0]); k['neck'] = R([0, 0, 0], [0, -sg * 38, 0])
    L = -sg * -1  # lead side x sign: right = -X
    lx = sg * 0.45
    k['hand_' + lead] = R([lx * 0.4, 1.0, 0.2], [lx, 1.30, FZ - 0.035]); k['palm_' + lead] = R([0, 0, 1], [0, 0, 1])
    k['fingers_' + lead] = R([sg * 0.6, 1, 0], [sg * 0.6, 1, 0]); k['elbow_' + lead] = R([sg * 0.8, -0.6, -0.2], [sg * 0.8, -0.6, -0.2])
    tx = -sg * 0.22
    k['hand_' + trail] = R([tx, 0.95, 0.0], [tx, 1.00, BZ + 0.035]); k['palm_' + trail] = R([0, 0, -1], [0, 0, -1])
    k['fingers_' + trail] = R([0, -1, 0], [0, -1, -0.2]); k['elbow_' + trail] = R([-sg * 0.8, -0.4, 0.2], [-sg * 0.8, -0.4, 0.2])
    for s in 'lr': k['hand_%s_w' % s] = ([(0, 0), (ramp_t * 0.9, 1), (dur, 1)] if ramp_t else [(0, 1)])
    return k, lead, trail
def squeeze(sg, base_loop, rm_loop, name):
    kL, lead, trail = squeeze_keys(sg, Lt)
    cl = author(tg, {k2: (v.copy() if hasattr(v, 'copy') else v) for k2, v in base_loop.items()}, kL); make_loop(tg, cl)
    IN = 0.7
    kI, _, _ = squeeze_keys(sg, IN, IN)
    ci = author(tg, base_from(tg, IDLE['T'], IDLE['R'], IN), kI)
    # end the enter on the loop's first pose
    crossfade_to(ci, cl['T'][0], cl['R'][0], IN * 0.55)
    def cs(c, window):
        Pw, _ = world(tg, c); out = []
        for s, z, n in ((lead, FZ, [0, 0, -1]), (trail, BZ, [0, 0, 1])):
            f = len(c['times']) - 1
            hp = Pw[f, tg.i('hand_' + s)] + (Pw[f, tg.i('middle_01_' + s)] - Pw[f, tg.i('hand_' + s)]) * 0.6
            pt = [hp[0], hp[1], z]
            out.append(contact('hand_' + s, 'hand_' + s, window, pt, n, 'wall', [pt[1] - 0.3, pt[1] + 0.3],
                               {'distance': [round(abs(z) - 0.05, 3), round(abs(z), 3), round(abs(z) + 0.1, 3)], 'facing': [0, 0, 1 if z > 0 else -1]},
                               blend=(0.2, 0.2), note=('lead palm on the FRONT wall (the one the chest faces)' if s == lead else 'trailing palm behind the hip on the BACK wall')))
        return out
    src = {'cmu': '111_26 Walk sideways (legs)', 'authored': 'arms on both walls, narrow chest, head turned to the travel'}
    gap = {'gap': [0.6, 1.0], 'frontZ': FZ, 'backZ': BZ, 'travel': 'right (-X)' if sg < 0 else 'left (+X)'}
    add(name + '_in', ci, False, {'authored': 'turn-in: palms onto both walls'}, AUTH_LIC, cs(ci, (IN * 0.8, IN)), tags=['contact', 'rock', 'gap', 'traverse'],
        notes='standing in the gap mouth, chest to the front wall -> palms onto both walls (0.7 s)', extra={'gap': gap})
    spd = float(np.linalg.norm(rm_loop[-1, :2]) / Lt)
    add(name + '_loop', cl, True, src, CMU_LIC + ' + ' + AUTH_LIC, cs(cl, (0, Lt)), tags=['contact', 'rock', 'gap', 'traverse'],
        notes='side-step cycle through a 0.6-1.0 m gap, native speed %.2f m/s along %s (scale timeScale = v/that); palms stay on the walls (runtime: re-cast per hand each frame)' % (spd, gap['travel']),
        extra={'gap': gap, 'locomotion': {'speed': round(spd, 3), 'cycle': round(float(Lt), 3), 'dir': [(-1 if sg < 0 else 1), 0],
               'rootMotionCycle': [[round(float(x), 4) for x in r] for r in rm_loop[::2]]}})
squeeze(-1, loop, rmL, 'squeeze_side_r')
lm = mirror(tg, loop); rmM = rmL * np.array([-1, 1, -1.0])
squeeze(1, lm, rmM, 'squeeze_side_l')

# ================================================================== write + merge onto the existing library
_orig_tracks = RT.clip_tracks
def masked_tracks(tg_, clip, **kw):
    tr = _orig_tracks(tg_, clip, **kw); m = clip.get('mask')
    return {k: v for k, v in tr.items() if k in m} if m else tr
RT.clip_tracks = masked_tracks
for n, c, m in NEW:
    if n in MASK and not os.environ.get('NOMASK'): c['mask'] = MASK[n]   # NOMASK=1: full-body preview build (contact sheets)
tmp = OUT + '/_rock_new.glb'
write_clips(tmp, tg, [(n, c, {'loop': m['loop']}) for n, c, m in NEW])

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
meta = json.load(open(W + '/anim_pilot_contact.meta.json'))
for n, _, m in NEW: meta['clips'][n] = m
jo['extras'] = dict(jo.get('extras', {})); jo['extras'].pop('animlib', None)
jo['extras']['rockClips'] = 'tools/anim/build_rock_clips.py'
js = json.dumps(jo, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(bo) % 4: bo.append(0)
open(OUT + '/anim_pilot_contact.glb', 'wb').write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bo)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bo), 0x004E4942) + bytes(bo))
json.dump(meta, open(OUT + '/anim_pilot_contact.meta.json', 'w'), indent=1)
os.remove(tmp)
print('merged: %d old + %d new clips' % (len(have), len(NEW)))
