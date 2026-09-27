# print compact motion signals of retargeted CMU clips (for picking windows): per 0.25 s
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from retarget import *
A = sys.argv[1]; tg = Target(A + '/pilot_aces_textured.glb')
for nm in sys.argv[2:]:
    c = retarget(tg, load_src(f'{A}/npz/{nm}.npz'), fps=30)
    Pw, Qw = world(tg, c); i = tg.i
    pel = Pw[:, i('pelvis')]
    rows = []
    for f in range(0, len(pel), int(os.environ.get("STEP", 8))):
        loc = lambda b: qrot(qaxis([0, 1, 0], -yaw_of(Qw[f, i('pelvis')])), Pw[f, i(b)] - pel[f])
        hl, hr = loc('hand_l'), loc('hand_r')
        rows.append(f"{f/30:4.1f}s p{pel[f,1]:.2f} L[{hl[0]:+.2f},{Pw[f,i('hand_l'),1]:.2f},{hl[2]:+.2f}] R[{hr[0]:+.2f},{Pw[f,i('hand_r'),1]:.2f},{hr[2]:+.2f}] fl{Pw[f,i('foot_l'),1]:.2f} fr{Pw[f,i('foot_r'),1]:.2f} yaw{np.degrees(yaw_of(Qw[f,i('pelvis')])):+4.0f} x{pel[f,0]:+.1f} z{pel[f,2]:+.1f}")
    print('==', nm, len(pel) / 30); print('\n'.join(rows))
