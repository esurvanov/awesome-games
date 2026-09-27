# retarget every dumped CMU clip in full (15 fps) -> one preview GLB, for picking time windows
import sys, glob, os, json
sys.path.insert(0, os.path.dirname(__file__))
from retarget import *
A = sys.argv[1]
tg = Target(A + '/pilot_aces_textured.glb')
out = []
for f in sorted(glob.glob(A + '/npz/*.npz')):
    nm = os.path.basename(f)[:-4]
    src = load_src(f)
    c = retarget(tg, src, fps=15)
    out.append(('cmu_' + nm, c, None))
    print(nm, len(c['times']), round(c['times'][-1], 1), flush=True)
print(write_clips(A + '/www/preview.glb', tg, out))
