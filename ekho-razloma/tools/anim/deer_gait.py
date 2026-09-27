"""Procedural, phase-based quadruped gait clips for the game's stag (assets/pack/animal_stag.js, CDmir CC0 rig).

Each gait = cycle period T, duty factor (stance fraction), per-foot phase offsets (footfall pattern). The body root
moves along a path (speed v(t), yaw rate w(t)); a foot in stance stays fixed in WORLD space (zero sliding by
construction), a swinging foot travels on an arc from its lift-off point to its predicted touchdown point
(= neutral foot position under the hip/shoulder at mid-stance, i.e. half a stance-length ahead). Legs are solved with
analytic 2-bone IK down to the fetlock; the pastern/hoof bone gets a phase-driven pitch (roll-over at push-off, folded
in swing). Clips are exported IN PLACE with the root path in metadata (rootMotion) + footfall events + stride/speed
for speed-matched, phase-synchronised blending (see ANIMLIB.md).

python3.11 deer_gait.py <workdir>   (needs <workdir>/animal_stag.glb) -> <workdir>/out/anim_stag_gaits.glb + .meta.json
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltfio import *
from retarget import two_bone_ik, world, reduce_keys, qcontinuous

W = sys.argv[1]; OUT = os.path.join(W, 'out'); os.makedirs(OUT, exist_ok=True)
FPS = 30.0
j, b = read_glb(W + '/animal_stag.glb'); SK = Skeleton(j, b)

class Rig:   # adapter for retarget.two_bone_ik / world
    sk = SK
    def i(self, n): return SK.idx[n]
tg = Rig()
P0, Q0 = SK.fk(SK.T, SK.R)
DEFORM = ['Hip', 'Backleg_L', 'Backleg_L.001', 'Backleg_L.002', 'Backleg_R', 'Backleg_R.001', 'Backleg_R.002', 'Backbone', 'Backbone.001',
          'Backbone.002', 'Head', 'Frontleg_L', 'Frontleg_L.001', 'Frontleg_L.002', 'Frontleg_R', 'Frontleg_R.001', 'Frontleg_R.002']
LEGS = {  # name: (upper, mid, hoof bone, knee pole in body space)
    'LH': ('Backleg_L', 'Backleg_L.001', 'Backleg_L.002', [0, 0.2, -1]), 'RH': ('Backleg_R', 'Backleg_R.001', 'Backleg_R.002', [0, 0.2, -1]),
    'LF': ('Frontleg_L', 'Frontleg_L.001', 'Frontleg_L.002', [0, 0.1, 1]), 'RF': ('Frontleg_R', 'Frontleg_R.001', 'Frontleg_R.002', [0, 0.1, 1])}
HOOF = {}
for k, (u, m, h, _) in LEGS.items():
    i = SK.idx[h]; ax = qrot(Q0[i], np.array([0, 1.0, 0])); L = P0[i, 1] / -ax[1]
    tip = P0[i] + ax * L
    top = P0[SK.idx[u]]
    # stance centre: under the hip / shoulder joint (hind a bit behind, fore a bit ahead) -> symmetric reach fore/aft
    cz = top[2] - 0.06 if k in ('LH', 'RH') else top[2] + 0.04
    HOOF[k] = dict(len=L, rest_pitch=np.arctan2(ax[2], -ax[1]), neutral=np.array([tip[0], 0.0, cz]), rest_tip=np.array([tip[0], 0.0, tip[2]]))
HIP_H = P0[SK.idx['Hip'], 1]
def _acc_scale(i):
    s = 1.0; p = SK.parent[i]
    while p >= 0: s *= SK.S[p][0]; p = SK.parent[p]
    return s
PSCALE = {i: _acc_scale(i) for i in range(SK.n)}   # glTF 'Root' node scales the rig by 0.305

GAITS = {  # T cycle s, duty, offsets (LH, LF, RH, RF), swing height m, body bob m (amp, harmonics), pitch deg, spine flex deg, head nod deg
    'walk':   dict(T=32 / 30, duty=0.64, off=dict(LH=0.0, LF=0.25, RH=0.5, RF=0.75), lift=0.13, bob=(0.012, 2), pitch=1.5, flex=1.5, nod=(5.0, 2), crouch=0.0),
    'trot':   dict(T=19 / 30, duty=0.42, off=dict(LH=0.0, RF=0.0, RH=0.5, LF=0.5), lift=0.20, bob=(0.030, 2), pitch=2.0, flex=2.5, nod=(3.0, 2), crouch=0.02),
    'canter': dict(T=16 / 30, duty=0.29, off=dict(RH=0.0, LH=0.22, RF=0.22, LF=0.42), lift=0.28, bob=(0.06, 1), pitch=6.0, flex=7.0, nod=(7.0, 1), crouch=0.06),
    'gallop': dict(T=13 / 30, duty=0.21, off=dict(RH=0.0, LH=0.09, RF=0.42, LF=0.52), lift=0.36, bob=(0.08, 1), pitch=8.0, flex=11.0, nod=(9.0, 1), crouch=0.09),
}
SPEED = {'walk': 1.3, 'trot': 3.0, 'canter': 6.0, 'gallop': 11.0}

def smooth(x): x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)

def root_path(ts, v, w):
    th = np.concatenate([[0], np.cumsum((w[1:] + w[:-1]) / 2 * np.diff(ts))])
    vx = v * np.sin(th); vz = v * np.cos(th)
    x = np.concatenate([[0], np.cumsum((vx[1:] + vx[:-1]) / 2 * np.diff(ts))]); z = np.concatenate([[0], np.cumsum((vz[1:] + vz[:-1]) / 2 * np.diff(ts))])
    return x, z, th

def to_world(x, z, th, p):   # root-local point(s) -> world at root pose
    c, s = np.cos(th), np.sin(th)
    return np.array([x + c * p[0] + s * p[2], p[1], z - s * p[0] + c * p[2]])

def to_local(x, z, th, p):
    c, s = np.cos(th), np.sin(th); dx, dz = p[0] - x, p[2] - z
    return np.array([c * dx - s * dz, p[1], s * dx + c * dz])

def simulate(gait, dur, v_fn, w_fn=lambda t: 0.0, phase0=0.0, settle=None, lead_in=0.0):
    """-> frames dict with root path and per-foot local hoof tip positions, hoof pitch, stance flags, events"""
    G = GAITS[gait]; dt = 1 / FPS
    ts_all = np.arange(-lead_in, dur + 1e-9, dt)
    v = np.array([v_fn(t) for t in ts_all]); w = np.array([w_fn(t) for t in ts_all])
    x, z, th = root_path(ts_all, v, w)
    # phase: advances at 1/T while moving; `settle` (t) -> after it, feet finish their current swing then stop
    phi = phase0 + np.concatenate([[0], np.cumsum(np.full(len(ts_all) - 1, dt / G['T']))])
    Tst = G['T'] * G['duty']
    feet = {}
    events = {k: [] for k in LEGS}
    for k in LEGS:
        off = G['off'][k]; nb = HOOF[k]['neutral']
        loc = np.zeros((len(ts_all), 3)); pitch = np.zeros(len(ts_all)); st = np.zeros(len(ts_all), bool)
        contact = to_world(x[0], z[0], th[0], nb)          # planted at neutral at t0
        lift_pt = contact.copy(); frozen = False
        prev_stance = True
        for n, t in enumerate(ts_all):
            u = (phi[n] - off) % 1.0
            stance = u < G['duty']
            if settle is not None and t >= settle:
                # after settle: once a foot is in stance near neutral it stays; swinging feet complete their swing to neutral
                if prev_stance and not stance and np.linalg.norm(to_local(x[n], z[n], th[n], contact)[[0, 2]] - nb[[0, 2]]) < 0.12:
                    frozen = True
                if frozen: stance = True
            if stance and not prev_stance:   # touchdown
                contact = td_pt; events[k].append(('td', round(float(t), 3)))
            if not stance and prev_stance:   # lift-off: predict touchdown at the next stance mid-point
                lift_pt = contact.copy(); events[k].append(('lo', round(float(t), 3)))
                t_sw = (1 - G['duty']) * G['T']; tm = min(t + t_sw + Tst / 2, ts_all[-1]); km = int(round((tm - ts_all[0]) * FPS))
                km = min(km, len(ts_all) - 1)
                vmid = v[km] if settle is None or tm < settle else 0.0
                td_local = nb.copy()
                if settle is not None and t + t_sw >= settle: td_local = nb.copy()
                td_pt = to_world(x[km], z[km], th[km], td_local)
                if settle is not None and t + t_sw >= settle:   # final placement: neutral under the final body pose
                    td_pt = to_world(x[-1], z[-1], th[-1], nb)
            if stance:
                pw = contact.copy(); s_st = u / G['duty'] if not frozen else 0.5
                # hoof pitch: +8 deg at touchdown -> -35 deg (heel up, roll over the toe) at push-off
                pitch[n] = np.radians(8 - 43 * smooth((s_st - 0.55) / 0.45)) if not frozen else np.radians(0)
            else:
                s = (u - G['duty']) / (1 - G['duty'])
                a = smooth(s)
                pw = lift_pt + (td_pt - lift_pt) * a
                pw[1] = G['lift'] * np.sin(np.pi * np.clip(s, 0, 1)) ** 0.9 * (0.6 if k in ('LH', 'RH') else 1.0) + 0.6 * G['lift'] * np.sin(np.pi * np.clip(s * 1.4, 0, 1)) ** 2 * (1.0 if k in ('LH', 'RH') else 0.3)
                pitch[n] = np.radians(-35 - 55 * np.sin(np.pi * np.clip(s * 1.15, 0, 1)) + 43 * smooth((s - 0.7) / 0.3))
            loc[n] = to_local(x[n], z[n], th[n], pw); st[n] = stance
            prev_stance = stance
        feet[k] = dict(local=loc, pitch=pitch, stance=st)
    keep = ts_all >= -1e-9
    out = dict(ts=ts_all[keep], x=x[keep] - x[keep][0], z=z[keep] - z[keep][0], th=th[keep] - th[keep][0], v=v[keep], w=w[keep], phi=phi[keep], gait=gait,
               feet={k: {kk: vv[keep] for kk, vv in f.items()} for k, f in feet.items()},
               events={k: [(e, round(tt, 3)) for e, tt in ev if tt >= 0] for k, ev in events.items()})
    # re-express root start at origin (rotate x,z by -th0)
    return out

def body_layers(sim, amp_scale=None):
    """hip bob/pitch, spine flex, head nod from gait phase (scaled by speed ramp)"""
    G = GAITS[sim['gait']]; phi = sim['phi']; F = len(phi)
    sc = np.ones(F) if amp_scale is None else amp_scale
    h_amp, h_harm = G['bob']; n_amp, n_harm = G['nod']
    # reference: lowest body just after the first hind touchdown
    bob = -h_amp * np.cos(2 * np.pi * h_harm * (phi - 0.08)) * sc
    pitch = np.radians(G['pitch']) * np.sin(2 * np.pi * (phi - 0.1)) * sc
    flex = np.radians(G['flex']) * np.sin(2 * np.pi * (phi + 0.05)) * sc
    nod = np.radians(n_amp) * np.sin(2 * np.pi * n_harm * (phi - 0.2)) * sc
    crouch = G['crouch'] * sc
    return bob - crouch, pitch, flex, nod

def pose_clip(sim, head_pitch=None, head_yaw=None, extra_roll=None, amp_scale=None, neck_up=None):
    ts = sim['ts']; F = len(ts)
    T = np.repeat(SK.T[None], F, 0).copy(); R = np.repeat(SK.R[None], F, 0).copy()
    c = dict(times=ts, T=T, R=R, fps=FPS)
    bob, pitch, flex, nod = body_layers(sim, amp_scale)
    ih = SK.idx['Hip']; par = SK.parent[ih]
    Pw, Qw = SK.fk(T, R)
    # turning: bank into the turn and bend the spine toward it
    yawrate = sim['w']; bank = -np.clip(yawrate * np.maximum(sim['v'], 0.5) * 0.02, -0.25, 0.25)
    bend = np.clip(yawrate * 0.12, -0.3, 0.3)
    # Hip world: rest + bob, rotated by pitch (about +X) and bank (about +Z)
    qx = qaxis(np.repeat([[1, 0, 0.0]], F, 0), -pitch); qz = qaxis(np.repeat([[0, 0, 1.0]], F, 0), bank + (0 if extra_roll is None else extra_roll))
    qy = qaxis(np.repeat([[0, 1, 0.0]], F, 0), -bend * 0.5)
    hipQ = qmul(qy, qmul(qz, qmul(qx, np.repeat(Q0[ih][None], F, 0))))
    hipP = np.repeat(P0[ih][None], F, 0) + np.stack([0 * bob, bob, 0 * bob], -1)
    R[:, ih] = qmul(qinv(Qw[:, par]), hipQ); T[:, ih] = qrot(qinv(Qw[:, par]), hipP - Pw[:, par]) / PSCALE[ih]
    # spine: flex (pitch about X) spread over Backbone, Backbone.001 ; turn bend (yaw) ; neck/head nod
    def rot_world(bone, q):
        i = SK.idx[bone]; p = SK.parent[i]; Pw, Qw = SK.fk(c['T'], c['R'])
        c['R'][:, i] = qmul(qinv(Qw[:, p]), qmul(q, Qw[:, i]))
    for bn, k in (('Backbone', 0.5), ('Backbone.001', 0.5)):
        rot_world(bn, qmul(qaxis(np.repeat([[0, 1, 0.0]], F, 0), bend * 0.5), qaxis(np.repeat([[1, 0, 0.0]], F, 0), flex * k)))
    hp = np.zeros(F) if head_pitch is None else head_pitch; hy = np.zeros(F) if head_yaw is None else head_yaw
    nu = np.zeros(F) if neck_up is None else neck_up
    rot_world('Backbone.002', qmul(qaxis(np.repeat([[0, 1, 0.0]], F, 0), bend * 0.8 + hy * 0.6), qaxis(np.repeat([[1, 0, 0.0]], F, 0), nod * 0.6 - nu)))
    rot_world('Head', qmul(qaxis(np.repeat([[0, 1, 0.0]], F, 0), hy * 0.4), qaxis(np.repeat([[1, 0, 0.0]], F, 0), nod * 0.4 + hp)))
    # legs
    for k, (u, m, h, pole) in LEGS.items():
        f = sim['feet'][k]; tip = f['local']; pit = f['pitch']
        # fetlock = tip + pastern vector (pitch about +X from vertical-ish rest)
        ang = HOOF[k]['rest_pitch'] + pit
        pastern = np.stack([np.zeros(F), np.cos(ang), -np.sin(ang)], -1) * HOOF[k]['len']    # from tip up to fetlock
        target = tip + pastern
        Pw, Qw = SK.fk(c['T'], c['R'])
        # scapula / pelvis-swing substitute: when the hoof is out of reach, slide the limb root toward it (<= cap)
        iu, im, ihf = SK.idx[u], SK.idx[m], SK.idx[h]
        la = np.linalg.norm(P0[im] - P0[iu]); lb = np.linalg.norm(P0[ihf] - P0[im])
        dv = target - Pw[:, iu]; dist = np.linalg.norm(dv, axis=-1)
        cap = 0.11 if k in ('LF', 'RF') else 0.07
        exc = np.clip(dist - 0.975 * (la + lb), 0, cap)
        # smooth the slide in time (no pops)
        ker = np.array([1, 2, 3, 2, 1.0]); ker /= ker.sum(); exc = np.convolve(np.pad(exc, 2, mode='wrap' if sim.get('loop_hint') else 'edge'), ker, 'valid')
        delta = dv / dist[:, None] * exc[:, None]
        pu = SK.parent[iu]
        c['T'][:, iu] = SK.T[iu] + qrot(qinv(Qw[:, pu]), delta) / PSCALE[iu]
        pl = np.repeat(np.array(pole, float)[None], F, 0)
        two_bone_ik(tg, c, (u, m, h), target, None, pole=pl, hint_pole_only=True)
        if os.environ.get('DBG'):
            Pd, _ = SK.fk(c['T'], c['R']); e = np.linalg.norm(Pd[:, SK.idx[h]] - target, axis=-1)
            e = e[len(e) // 2:]
            if e.max() > 0.01: print('   IK miss (2nd half)', k, 'max %.3f' % e.max(), 'frames', int((e > 0.01).sum()), '/', len(e))
        # hoof bone world rotation: rest rotated by pitch delta about X
        Pw, Qw = SK.fk(c['T'], c['R']); i = SK.idx[h]; p = SK.parent[i]
        qh = qmul(qaxis(np.repeat([[1, 0, 0.0]], F, 0), -pit), np.repeat(Q0[i][None], F, 0))
        c['R'][:, i] = qmul(qinv(Qw[:, p]), qh)
    return c

def cycle(sim, n_skip=2):
    """cut exactly one steady-state cycle (after n_skip cycles) so the clip loops seamlessly"""
    T = GAITS[sim['gait']]['T']; f0 = int(round(n_skip * T * FPS)); f1 = f0 + int(round(T * FPS))
    return f0, f1

LIB = []
def meta_for(name, sim, c, loop, f0=0, f1=None, extra=None):
    G = GAITS[sim['gait']]; f1 = len(c['times']) - 1 if f1 is None else f1
    ts = sim['ts'][f0:f1 + 1] - sim['ts'][f0]
    rm = np.stack([sim['x'][f0:f1 + 1], sim['z'][f0:f1 + 1], sim['th'][f0:f1 + 1]], -1)
    # express root motion relative to the clip start pose
    th0 = rm[0, 2]; cc, ss = np.cos(-th0), np.sin(-th0); dx = rm[:, 0] - rm[0, 0]; dz = rm[:, 1] - rm[0, 1]
    rm = np.stack([cc * dx + ss * dz, -ss * dx + cc * dz, rm[:, 2] - th0], -1)
    ev = {k: [(e, round(t - sim['ts'][f0], 3)) for e, t in sim['events'][k] if sim['ts'][f0] - 1e-6 <= t <= sim['ts'][f1] + 1e-6] for k in LEGS}
    dur = float(ts[-1])
    m = {'name': name, 'duration': round(dur, 4), 'loop': loop, 'fps': FPS, 'gait': sim['gait'],
         'speed': round(float(np.mean(sim['v'][f0:f1 + 1])), 3), 'yawRate_degps': round(float(np.degrees(np.mean(sim['w'][f0:f1 + 1]))), 2),
         'cycle': G['T'], 'duty': G['duty'], 'phaseOffsets': G['off'],
         'strideLength': round(float(np.mean(sim['v'][f0:f1 + 1]) * G['T']), 3),
         'footfalls': ev, 'phaseRef': 'phase 0 = first foot of phaseOffsets touching down... see ANIMLIB.md (all gaits share: phase = (t / cycle) mod 1)',
         'rootMotion': {'fps': FPS / 2, 'samples': [[round(float(a), 4) for a in r] for r in rm[::2]], 'total': [round(float(a), 4) for a in rm[-1]]},
         'source': {'procedural': 'tools/anim/deer_gait.py (phase-based footfall + IK on the stag rig)'}, 'license': 'authored for this project; rig/mesh CDmir CC0'}
    if extra: m.update(extra)
    return m

EXISTING = {'Run': 'CDmir clip: hooves move back at only ~0.5-2.8 m/s in stance -> slides badly at the 11 m/s flee speed; replace with gallop_loop',
            'Idle': 'keep (breathing idle)', 'Eat': 'keep (grazing)', 'LookAround': 'keep', 'Die': 'keep'}

def add(name, sim, loop, f0=0, f1=None, extra=None, **pose_kw):
    c = pose_clip(sim, **pose_kw)
    f1 = len(c['times']) - 1 if f1 is None else f1
    cc = dict(times=c['times'][f0:f1 + 1] - c['times'][f0], T=c['T'][f0:f1 + 1], R=c['R'][f0:f1 + 1], fps=FPS)
    m = meta_for(name, sim, cc, loop, f0, f1, extra)
    LIB.append((name, cc, m)); print(' +', name, m['duration'], 's', 'v=%.1f' % m['speed'], 'stride=%.2f' % m['strideLength'], flush=True)

# ---------------------------------------------------------------- loops (straight + turns)
for g in ('walk', 'trot', 'canter', 'gallop'):
    T = GAITS[g]['T']; v = SPEED[g]
    sim = simulate(g, 4 * T + 0.1, lambda t, v=v: v)
    f0, f1 = cycle(sim); add(g + '_loop', sim, True, f0, f1)
    for side, sgn in (('l', 1), ('r', -1)):
        wdeg = {'walk': 50, 'trot': 60, 'canter': 45, 'gallop': 35}[g]
        sim = simulate(g, 4 * T + 0.1, lambda t, v=v: v, lambda t, s=sgn, w=wdeg: s * np.radians(w))
        f0, f1 = cycle(sim); add('%s_turn_%s' % (g, side), sim, True, f0, f1, extra={'turnRadius_m': round(v / np.radians(wdeg), 2)})

# ---------------------------------------------------------------- start / stop transitions
ramp = lambda t, t0, t1, a, b: a + (b - a) * smooth((t - t0) / (t1 - t0))
sim = simulate('walk', 1.6, lambda t: ramp(t, 0.0, 1.0, 0.0, SPEED['walk']), phase0=0.62)
add('walk_start', sim, False, extra={'from': 'idle', 'to': 'walk_loop', 'syncPhaseAtEnd': round(float(sim['phi'][-1] % 1), 3)}, amp_scale=smooth(sim['ts'] / 1.0))
sim = simulate('walk', 2.2, lambda t: ramp(t, 0.0, 1.0, SPEED['walk'], 0.0), settle=0.9)
add('walk_stop', sim, False, extra={'from': 'walk_loop', 'to': 'idle', 'syncPhaseAtStart': 0.0}, amp_scale=1 - smooth(sim['ts'] / 1.1))
# flee burst: standing -> gallop in ~1 s (bounding first strides)
sim = simulate('gallop', 1.8, lambda t: ramp(t, 0.0, 1.1, 0.0, SPEED['gallop']), phase0=0.70)
add('gallop_start', sim, False, extra={'from': 'idle/alert', 'to': 'gallop_loop', 'syncPhaseAtEnd': round(float(sim['phi'][-1] % 1), 3)},
    amp_scale=0.4 + 0.6 * smooth(sim['ts'] / 0.8), head_pitch=-0.25 * (1 - smooth(sim['ts'] / 0.5)))
sim = simulate('trot', 2.0, lambda t: ramp(t, 0.0, 1.2, SPEED['trot'], 0.0), settle=1.0)
add('trot_stop', sim, False, extra={'from': 'trot_loop', 'to': 'idle'}, amp_scale=1 - smooth(sim['ts'] / 1.2))

# ---------------------------------------------------------------- idles: alert (head up, ears forward), look L/R, stamp
def standing(dur):
    ts = np.arange(0, dur + 1e-9, 1 / FPS); F = len(ts)
    return dict(ts=ts, x=np.zeros(F), z=np.zeros(F), th=np.zeros(F), v=np.zeros(F), w=np.zeros(F), phi=np.zeros(F), gait='walk',
                feet={k: dict(local=np.repeat(HOOF[k]['neutral'][None], F, 0), pitch=np.zeros(F), stance=np.ones(F, bool)) for k in LEGS},
                events={k: [] for k in LEGS})
L = 3.0
sim = standing(L); ts = sim['ts']
breath = 0.012 * np.sin(2 * np.pi * 2 * ts / L)
alert_up = np.radians(22) + breath; yaw = np.radians(18) * np.sin(2 * np.pi * ts / L)
add('alert_loop', sim, True, head_pitch=-np.radians(8) + 0 * ts, head_yaw=yaw, neck_up=alert_up, amp_scale=0 * ts,
    extra={'notes': 'neck raised ~22 deg, head scans +-18 deg; use when the player is noticed (before flee)'})
for side, sgn in (('l', 1), ('r', -1)):
    sim = standing(2.4); ts = sim['ts']
    k = smooth(ts / 0.5) * (1 - smooth((ts - 1.7) / 0.6))
    add('look_%s' % side, sim, False, head_yaw=sgn * np.radians(55) * k, neck_up=np.radians(12) * k, amp_scale=0 * ts,
        extra={'notes': 'one-shot head turn ~55 deg to the %s side and back' % ('left' if sgn > 0 else 'right')})
# alarm stamp with the right fore
sim = standing(1.6); ts = sim['ts']
f = sim['feet']['RF']; lift = np.clip(np.sin(np.pi * np.clip((ts - 0.3) / 0.45, 0, 1)), 0, 1)
f['local'] = f['local'].copy(); f['local'][:, 1] += 0.30 * lift; f['local'][:, 2] += 0.10 * lift
f['pitch'] = f['pitch'] - np.radians(70) * lift
sim['events']['RF'] = [('lo', 0.3), ('td', 0.75)]
add('stamp', sim, False, neck_up=np.radians(18) * smooth(ts / 0.3), head_pitch=-np.radians(6) * smooth(ts / 0.3), amp_scale=0 * ts,
    extra={'notes': 'alarm foot-stamp (right fore), neck up'})

# ---------------------------------------------------------------- write
from retarget import write_clips
class T2:   # write_clips needs tg.sk (joints subset), clip_tracks over joints
    sk = SK
size = write_clips(OUT + '/anim_stag_gaits.glb', T2, [(n, c, {'loop': m['loop']}) for n, c, m in LIB],
                   {'skeleton': 'animal_stag (CDmir) 31 joints', 'generator': 'tools/anim/deer_gait.py'})
meta = {'version': 1, 'skeleton': 'animal_stag.js (CDmir CC0), 31 joints; native units (stag withers ~1.0 m, hip 0.98 m)',
        'gaitTable': {g: dict(GAITS[g], speed=SPEED[g], strideLength=round(SPEED[g] * GAITS[g]['T'], 3)) for g in GAITS},
        'existingClips': EXISTING, 'clips': {m['name']: m for _, _, m in LIB}}
json.dump(meta, open(OUT + '/anim_stag_gaits.meta.json', 'w'), indent=1)
print('wrote', len(LIB), 'clips', size)
