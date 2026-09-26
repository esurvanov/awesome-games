from retarget import *
def load_clip(tg, glb, name, fps=30):
    sk = Skeleton(*read_glb(glb)); ai = sk.anim_names().index(name); ts, T, R = sk.sample(ai, fps)
    F = len(ts); Tl = np.repeat(tg.sk.T[None], F, 0).copy(); Rl = np.repeat(tg.sk.R[None], F, 0).copy()
    for i, n in enumerate(tg.sk.names):
        if n in sk.idx: Tl[:, i] = T[:, sk.idx[n]]; Rl[:, i] = R[:, sk.idx[n]]
    return dict(times=ts, T=Tl, R=Rl, fps=fps)
