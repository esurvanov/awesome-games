"""Automatic quality checks for the built pilot clip library (reads the written GLB back, so it checks what ships).
python3.11 qc_pilot.py <workdir>  -> <workdir>/out/qc_pilot.json + table on stdout"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from loadlib import *

W = sys.argv[1]
tg = Target(W + '/pilot_aces_textured.glb')
glb = W + '/out/anim_pilot_contact.glb'; meta = json.load(open(W + '/out/anim_pilot_contact.meta.json'))['clips']
_M = json.load(open(W + '/out/anim_pilot_contact.meta.json')); PALM = _M.get('palm', {})
rest_foot = tg.Pw[tg.i('foot_l'), 1]; rest_ball = tg.Pw[tg.i('ball_l'), 1]
rows = {}
for name, m in meta.items():
    c = load_clip(tg, glb, name)
    Pw, Qw = world(tg, c); F = len(c['times'])
    r = {}
    # re-apply the root-motion curve (what the runtime does) so slides/contacts are judged in world space
    rmS = (m.get('rootMotion') or {}).get('samples') or (m.get('locomotion') or {}).get('rootMotionCycle')
    if rmS:
        rmA = np.array(rmS); tt = np.arange(len(rmA)) / 15.0
        rmF = np.stack([np.interp(c['times'], tt, rmA[:, k]) for k in range(3)], -1)
        Yq = qaxis(np.repeat([[0, 1, 0.0]], F, 0), rmF[:, 2])
        Pw = qrot(Yq[:, None], Pw) + np.stack([rmF[:, 0], 0 * rmF[:, 0], rmF[:, 1]], -1)[:, None]
        Qw = qmul(Yq[:, None], Qw)
    # ground penetration (ankle/ball below their rest heights)
    pen = min((Pw[:, tg.i(b + s), 1] - (rest_foot if b == 'foot_' else rest_ball)).min() for b in ('foot_', 'ball_') for s in 'lr')
    r['groundPen_cm'] = round(float(min(0, pen)) * 100, 1)
    # foot slide while planted (ball low & slow): max horizontal drift inside each plant
    slide = 0.0
    for s in 'lr':
        b = Pw[:, tg.i('ball_' + s)]; y = b[:, 1] - rest_ball
        v = np.linalg.norm(np.gradient(b[:, [0, 2]], axis=0), axis=-1) * 30
        for s0, s1 in contacts(y, v, 0.04, 0.5, minlen=5):
            d = np.linalg.norm(b[s0:s1 + 1, [0, 2]] - b[s0, [0, 2]], axis=-1).max(); slide = max(slide, d)
    r['footSlide_cm'] = round(slide * 100, 1)
    # knees: bending backwards (hyperextension) = knee behind the hip-ankle line relative to the foot direction
    hyper = 0.0
    for s in 'lr':
        a, k, f, bl = Pw[:, tg.i('thigh_' + s)], Pw[:, tg.i('calf_' + s)], Pw[:, tg.i('foot_' + s)], Pw[:, tg.i('ball_' + s)]
        ax = f - a; ax /= np.linalg.norm(ax, axis=-1, keepdims=True)
        off = (k - a) - np.sum((k - a) * ax, -1, keepdims=True) * ax
        fwd = qrot(Qw[:, tg.i('pelvis')], np.array([0, 0, 1.0])) * np.array([1, 0, 1]); fwd /= np.linalg.norm(fwd, axis=-1, keepdims=True) + 1e-9
        hyper = min(hyper, float(np.sum(off * fwd, -1).min()))
    r['kneeBack_cm'] = round(hyper * 100, 1)
    # elbows bending the wrong way: forearm folding past straight measured against the upper-arm "inside"
    # pops: max joint angular speed (deg/s) excluding fingers
    body = [i for i, n in enumerate(tg.sk.names) if not any(x in n for x in ('thumb', 'index', 'middle', 'ring', 'pinky', 'leaf', 'Armature', 'root', 'Pilot'))]
    q = c['R'][:, body]; dq = np.abs(np.sum(q[1:] * q[:-1], -1)); ang = 2 * np.degrees(np.arccos(np.clip(dq, 0, 1))) * 30
    r['maxJointSpeed_dps'] = int(ang.max()); r['maxJointSpeedBone'] = tg.sk.names[body[int(np.argmax(ang.max(0)))]]
    # loop seam
    if m['loop']:
        idx = [tg.i(n) for n in ('pelvis', 'spine_03', 'Head', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r')]
        seam = max(2 * np.degrees(np.arccos(np.clip(abs(np.sum(c['R'][0, i] * c['R'][-1, i])), 0, 1))) for i in idx)
        r['loopSeam_deg'] = round(float(seam), 2)
        r['loopSeamPelvis_cm'] = round(float(np.linalg.norm(Pw[0, tg.i('pelvis')] - Pw[-1, tg.i('pelvis')])) * 100, 1)
    # contact accuracy: effector distance to its annotated point during the window
    errs = []
    for ct in m['contacts']:
        if not ct['bone'].startswith('hand') or not ct.get('hold'): continue
        f0, f1 = int(ct['window'][0] * 30), min(F - 1, int(ct['window'][1] * 30))
        s = ct['bone'][-1]
        h = Pw[f0:f1 + 1, tg.i('hand_' + s)]; mid = Pw[f0:f1 + 1, tg.i('middle_01_' + s)]
        palm = h + (mid - h) * 0.6
        if ct.get('palm') and PALM.get(s):      # palm-fixed clips: the drawn palm centre (glove rigid with the forearm), surface.point IS the palm centre
            il = tg.i('lowerarm_' + s); Lw = q_to_mat(Qw[f0:f1 + 1, il]); palm = Pw[f0:f1 + 1, il] + np.einsum('fij,j->fi', Lw, np.array(PALM[s]['inForearm']))
        n = np.array(ct['surface']['normal']); p = np.array(ct['surface']['point'])
        if rmS and ct.get('space', 'character') == 'character': p = qrot(Yq[f0:f1 + 1], p) + np.stack([rmF[f0:f1 + 1, 0], 0 * rmF[f0:f1 + 1, 0], rmF[f0:f1 + 1, 1]], -1); n = qrot(Yq[f0:f1 + 1], n)
        n = np.broadcast_to(n, palm.shape)
        d = np.abs(np.sum((palm - n * (0.0 if ct.get('palm') else 0.035) - p) * n, -1))   # palm surface to the contact plane (palm-fixed: the palm centre itself)
        drift = np.linalg.norm(palm - palm[0], axis=-1).max()
        errs.append((ct['effector'], round(float(d.max()) * 100, 1), round(float(drift) * 100, 1)))
    if errs: r['contactPlaneErr_cm/drift_cm'] = errs
    rows[name] = r
json.dump(rows, open(W + '/out/qc_pilot.json', 'w'), indent=1)
for n, r in rows.items(): print(n.ljust(24), json.dumps(r))
