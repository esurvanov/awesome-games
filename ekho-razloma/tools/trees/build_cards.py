#!/usr/bin/env python3
"""build_cards.py — the crown as photo-sprig cards (replaces the thinned-needle idea).

The source fir is ~0.4-4 M tiny needle clusters; random thinning + scaling turned them into spiky sticks. A conifer crown in a game is built
from sprig cards (photographed twigs with real needles + a normal map): the SHAPE of the crown comes from the scan — one cluster per voxel
keeps its position, its needle direction and its depth in the crown (AO) — and every kept cluster becomes a pair of crossed sprig cards
(8 triangles... no: 2 quads = 4 triangles) so the crown has real thickness from any side.
  LOD0  voxel 0.20 m, cards ~0.5 m      (near)
  LOD1  voxel 0.50 m, cards ~1.2 m      (mid)
Outputs out/<asset>_<k>/cards_l0.npz, cards_l1.npz (pos nrm uv col idx) — assemble_firs.py picks them up."""
import os, sys, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

SRC = os.path.join(HERE, 'src', 'fir_tree_01'); CX0, CH = 368, 1638; CW = 2048 - CX0
M_PER_PX = 0.55 / 783.0                                         # the big sprig (708 x 783 px) is ~0.55 m tall; needles come out ~2 cm
LOD = {'l0': {'voxel': 0.26, 'scale': 1.3}, 'l1': {'voxel': 0.45, 'scale': 2.1}}
# per asset / variant: voxel multiplier on LOD0 (size budget: a dense scan gets a coarser cover, a sparse one a finer one) and the sprig size scale
CFG = {'fir_tree_01': {'vox': {0: 1.30, 1: 0.95, 2: 0.65}, 'sprig': 1.0}, 'fir_sapling_medium': {'vox': {0: 0.55, 1: 0.58, 2: 0.58}, 'sprig': 0.8}}

def sprites():
    a = np.array(Image.open(f'{SRC}/tex2k/twig_alpha_2k.png').convert('L')).astype(np.float32) / 255
    H, W = a.shape; m = a > 0.35; m[:, :CX0] = False; m[CH:, :] = False
    lab, n = ndi.label(ndi.binary_dilation(m, iterations=14)); out = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        sub = m[sl]; ys, xs = np.where(sub)
        if sub.sum() < 8000 or (xs.max() - xs.min()) < 140: continue                    # drop the thin needle-strip and crumbs
        out.append((sl[1].start + xs.min() - CX0, sl[0].start + ys.min(), sl[1].start + xs.max() - CX0, sl[0].start + ys.max()))
    return out                                                                           # (x0, y0, x1, y1) in the cropped atlas, y down

def build(asset, k):
    cfg = CFG[asset]; d = os.path.join(HERE, 'out', f'{asset}_{k}'); z = np.load(f'{d}/clusters.npz')
    cen, ax_, ao, needle, rn, tax = z['cen'], z['axis'], z['ao'], z['needle'], z['rn'], z['tree_axis']
    rects = sprites(); rng = np.random.RandomState(77 + k)
    idx_n = np.where(needle)[0]
    out = {}
    for lod, cfg0 in LOD.items():
        vox = cfg0['voxel'] * (cfg['vox'][k] if lod == 'l0' else 1.0); sc = cfg0['scale'] * cfg['sprig']
        # one cluster per voxel (random pick): a blue-noise-ish cover of the crown that keeps its shape and density falloff
        key = np.floor(cen[idx_n] / vox).astype(np.int64); kk = key[:, 0] * 73856093 ^ key[:, 1] * 19349663 ^ key[:, 2] * 83492791
        perm = rng.permutation(len(idx_n)); _, first = np.unique(kk[perm], return_index=True); pick = idx_n[perm[first]]
        P = []; Nn = []; UVs = []; C = []; I = []; base = 0
        for g in pick:
            c = cen[g].astype(np.float64); r = c - np.array([tax[0], c[1] - 1.5 * 0, tax[1]])   # outward from the trunk axis
            rad = np.array([c[0] - tax[0], 0, c[2] - tax[1]]); rl = np.linalg.norm(rad); rad = rad / rl if rl > 1e-4 else np.array([1, 0, 0])
            a = ax_[g].astype(np.float64)
            if np.dot(a, rad) < 0: a = -a                                                    # sprigs grow away from the trunk
            a = a + rng.normal(0, 0.18, 3); a /= np.linalg.norm(a)
            # the main card lies in a (near-)horizontal plane through the sprig axis — a conifer's lateral sprigs are fans lying flat, tier on tier,
            # and a flat card is where the snow settles; the crossing card stands vertical. Near-vertical axes (the leader) get a random roll
            up = np.array([0, 1, 0])
            if abs(a[1]) < 0.85:
                l1 = np.cross(up, a); l1 /= np.linalg.norm(l1); roll = rng.normal(0, 0.45)
            else:
                l1 = np.cross(a, np.array([1, 0, 0])); l1 /= np.linalg.norm(l1); roll = rng.uniform(0, 2 * np.pi)
            l1 = l1 * np.cos(roll) + np.cross(a, l1) * np.sin(roll); l2 = np.cross(a, l1)
            x0, y0, x1, y1 = rects[rng.randint(len(rects))]
            wpx, hpx = x1 - x0, y1 - y0; hm = hpx * M_PER_PX * sc * rng.uniform(0.85, 1.15); wm = wpx * M_PER_PX * sc
            nrm = np.array([rad[0] * 1.0, 0.30 + 0.5 * (1 - rn[g] if rn[g] < 1 else 0), rad[2] * 1.0]); nrm /= np.linalg.norm(nrm)
            base_pt = c - a * hm * 0.25                                                      # the sprig root sits a little behind the cluster centre
            u0, u1 = x0 / CW, x1 / CW; v0, v1 = y0 / CH, y1 / CH                              # v from the top (glTF, flipY false): tip at v0, root at v1
            for l in (l1, l2):
                q = [base_pt - l * wm / 2, base_pt + l * wm / 2, base_pt + a * hm + l * wm / 2, base_pt + a * hm - l * wm / 2]
                P.extend(q); Nn.extend([nrm] * 4); UVs.extend([[u0, v1], [u1, v1], [u1, v0], [u0, v0]]); C.extend([[ao[g], ao[g], ao[g], 1.0]] * 4)
                I.extend([[base, base + 1, base + 2], [base, base + 2, base + 3]]); base += 4
        out[lod] = dict(pos=np.array(P, np.float32), nrm=np.array(Nn, np.float32), uv=np.array(UVs, np.float32), col=np.array(C, np.float32), idx=np.array(I, np.uint32))
        np.savez_compressed(f'{d}/cards_{lod}.npz', **out[lod])
        print(f'variant {k} {lod}: {len(pick)} sprigs, {len(I)} tris, sprites {len(rects)}')
    return out

if __name__ == '__main__':
    asset = sys.argv[1] if len(sys.argv) > 1 else 'fir_tree_01'
    for k in ([int(x) for x in sys.argv[2:]] or [0, 1, 2]): build(asset, k)
