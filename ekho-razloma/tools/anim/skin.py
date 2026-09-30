"""Linear-blend skinning of the pilot mesh on the CPU (numpy): lets the build scripts measure the DRAWN glove / boot /
suit against a contact surface instead of bone positions.
    S = Skin(tg, 'pilot_aces_textured.glb'); V = S.verts(clip, f, mask=S.glove('l'))   # world positions [n,3]
Vertex selection is by the dominant skin weight's bone (hand / finger bones of one side = the glove)."""
import numpy as np
from gltfio import read_glb, accessor, q_to_mat

FINGERS = ('thumb', 'index', 'middle', 'ring', 'pinky')

class Skin:
    def __init__(self, tg, glb):
        j, b = read_glb(glb)
        sk = j['skins'][0]; self.joints = sk['joints']
        self.ibm = accessor(j, b, sk['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)   # column-major -> row-major
        P, J, W, F, PR = [], [], [], [], []; off = 0; k = 0
        for m in j['meshes']:
            for p in m['primitives']:
                a = p['attributes']; P.append(accessor(j, b, a['POSITION'])); J.append(accessor(j, b, a['JOINTS_0']).astype(int)); W.append(accessor(j, b, a['WEIGHTS_0']))
                n = len(P[-1]); PR.append(np.full(n, k)); k += 1
                if 'indices' in p: F.append(accessor(j, b, p['indices']).astype(int).reshape(-1, 3) + off)
                off += n
        self.F = np.concatenate(F) if F else np.zeros((0, 3), int); self.prim = np.concatenate(PR)
        self.P = np.concatenate(P).astype(float); self.J = np.concatenate(J); self.W = np.concatenate(W).astype(float)
        self.W /= np.maximum(self.W.sum(1, keepdims=True), 1e-9)
        self.tg = tg
        names = tg.sk.names
        top = self.J[np.arange(len(self.J)), np.argmax(self.W, 1)]
        self.top = np.array([names[self.joints[k]] for k in top])

    def glove(self, s):
        return np.array([(n == 'hand_' + s) or (n.endswith('_' + s) and n.startswith(FINGERS)) for n in self.top])

    def part(self, *bones):
        return np.isin(self.top, bones)

    def mats(self, T, R):
        Pw, Qw = self.tg.sk.fk(T[None], R[None]); Pw, Qw = Pw[0], Qw[0]
        # fk() carries uniform scale in positions only; the root node scale (if any) applies to the whole joint frame
        sc = np.ones(len(Pw))
        S = self.tg.sk.S
        for i in self.tg.sk.order:
            p = self.tg.sk.parent[i]; sc[i] = (sc[p] if p >= 0 else 1.0) * S[i][0]
        M = np.zeros((len(self.joints), 4, 4))
        for k, ji in enumerate(self.joints):
            m = np.eye(4); m[:3, :3] = q_to_mat(Qw[ji][None])[0] * sc[ji]; m[:3, 3] = Pw[ji]
            M[k] = m @ self.ibm[k]
        return M

    def verts(self, clip, f, mask=None):
        M = self.mats(clip['T'][f], clip['R'][f])
        P, J, W = (self.P, self.J, self.W) if mask is None else (self.P[mask], self.J[mask], self.W[mask])
        ph = np.concatenate([P, np.ones((len(P), 1))], 1)
        out = np.zeros((len(P), 3))
        for k in range(4):
            out += W[:, k:k + 1] * np.einsum('nij,nj->ni', M[J[:, k]], ph)[:, :3]
        return out
