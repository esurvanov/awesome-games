"""QC for stag gait clips (reads the written GLB): hoof slide during stance with root motion re-applied, ground
penetration, loop seam, IK reach misses. python3.11 qc_stag.py <workdir>"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltfio import *

W = sys.argv[1]
j, b = read_glb(W + '/animal_stag.glb'); SK = Skeleton(j, b)
A = Skeleton(*read_glb(W + '/out/anim_stag_gaits.glb')); meta = json.load(open(W + '/out/anim_stag_gaits.meta.json'))['clips']
P0, Q0 = SK.fk(SK.T, SK.R)
HO = {}
for k, h in (('LH', 'Backleg_L.002'), ('RH', 'Backleg_R.002'), ('LF', 'Frontleg_L.002'), ('RF', 'Frontleg_R.002')):
    i = SK.idx[h]; ax = qrot(Q0[i], np.array([0, 1.0, 0])); HO[k] = (i, P0[i, 1] / -ax[1])
rows = {}
for name, m in meta.items():
    ai = A.anim_names().index(name); ts, T, R = A.sample(ai, 30)
    F = len(ts); Tl = np.repeat(SK.T[None], F, 0).copy(); Rl = np.repeat(SK.R[None], F, 0).copy()
    for i, n in enumerate(SK.names):
        if n in A.idx: Tl[:, i] = T[:, A.idx[n]]; Rl[:, i] = R[:, A.idx[n]]
    Pw, Qw = SK.fk(Tl, Rl)
    rm = np.array(m['rootMotion']['samples']); tt = np.arange(len(rm)) / m['rootMotion']['fps']
    rmF = np.stack([np.interp(ts, tt, rm[:, k]) for k in range(3)], -1)
    r = {'speed': m['speed'], 'stride': m['strideLength']}
    slide = 0; pen = 0; minh = 9
    for k, (i, L) in HO.items():
        tip = Pw[:, i] + qrot(Qw[:, i], np.array([0, L, 0]))
        c, s = np.cos(rmF[:, 2]), np.sin(rmF[:, 2])
        wx = rmF[:, 0] + c * tip[:, 0] + s * tip[:, 2]; wz = rmF[:, 1] - s * tip[:, 0] + c * tip[:, 2]
        pen = min(pen, tip[:, 1].min())
        # stance frames from footfall events
        ev = m['footfalls'][k]; st = np.zeros(F, bool)
        tds = [t for e, t in ev if e == 'td']; los = [t for e, t in ev if e == 'lo']
        # stance = between td and next lo (and from start if first event is lo)
        marks = sorted([(t, e) for e, t in ev]); cur = (not marks) or marks[0][1] == 'lo'; last = 0.0
        for t, e in marks + [(ts[-1] + 1, 'end')]:
            if cur:
                tr = min(0.04, 0.15 * max(t - last, 0)); sel = (ts >= last + tr) & (ts <= t - tr)
                if sel.sum() > 1:
                    d = np.hypot(wx[sel] - wx[sel][0], wz[sel] - wz[sel][0]).max(); slide = max(slide, d)
            cur = (e == 'td'); last = t
    r['hoofSlide_cm'] = round(float(slide) * 100, 1); r['hoofBelowGround_cm'] = round(float(min(0, pen)) * 100, 1)
    if m['loop']:
        idx = [SK.idx[n] for n in ('Hip', 'Backleg_L', 'Backleg_L.001', 'Frontleg_R', 'Frontleg_R.001', 'Head')]
        r['loopSeam_deg'] = round(max(2 * np.degrees(np.arccos(np.clip(abs(np.sum(Rl[0, i] * Rl[-1, i])), 0, 1))) for i in idx), 2)
    rows[name] = r
json.dump(rows, open(W + '/out/qc_stag.json', 'w'), indent=1)
for n, r in rows.items(): print(n.ljust(16), json.dumps(r))
