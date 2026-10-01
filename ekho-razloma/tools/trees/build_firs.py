#!/usr/bin/env python3
"""build_firs.py — game-ready conifers from Poly Haven scans (CC0).

Source (tools/trees/src/<asset>/…, see fetch_ph.py): a photogrammetry-grade fir: ~0.4–4 M "needle" clusters of 4 triangles
(~4 cm) + a trunk of 80 k triangles. Too heavy for a browser. This script, per variant (the glTF holds 3 trees):
  * splits the twig mesh into groups (one group = one cluster: contiguous vertex run) — needles (UV in the atlas strip u > .15) and stems
  * thins the needles to a LOD0 / LOD1 share and scales the survivors about their centre so the crown keeps its mass
  * writes a per-group crown AO (deep in the crown = dark, outer = light) to COLOR_0.r — the game's needle shader reads it
  * dumps the trunk / branch-stub / dead-branch meshes for Blender (tools/trees/blender_decimate.py)
  python3 tools/trees/build_firs.py fir_tree_01
Outputs tools/trees/out/<asset>_<k>/{needles_l0,needles_l1,stems}.npz and trunk_raw.glb."""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import read_gltf, write_glb

HERE = os.path.dirname(os.path.abspath(__file__))
# per-LOD triangle budget of the needles (a crown-level number, not per variant): LOD0 near the pilot, LOD1 mid distance
BUDGET = {'l0': 70000, 'l1': 16000}
STEM_BUDGET = {'l0': 4500, 'l1': 1500}   # twig stems are long (60–100 triangles each): budgeted by triangles, not by share

def groups_of(I):
    mx = I.max(axis=1).astype(np.int64); mn = I.min(axis=1).astype(np.int64); rm = np.maximum.accumulate(mx)
    starts = np.concatenate([[0], np.where(mn[1:] > rm[:-1])[0] + 1]); ends = np.concatenate([starts[1:], [len(I)]])
    return starts, ends

def build_variant(asset, k):
    j, acc = read_gltf(os.path.join(HERE, 'src', asset, f'{asset}_1k.gltf'))
    mesh = j['meshes'][k]; out = os.path.join(HERE, 'out', f'{asset}_{k}'); os.makedirs(out, exist_ok=True)
    prim = {j['materials'][p['material']]['name'].replace(asset + '_', ''): p for p in mesh['primitives']}
    nk = next(n for n in prim if 'twig' in n and 'dead' not in n)   # 'twig' (fir_tree_01) / 'twigs' (fir_sapling_medium): the needle clusters + stems
    tw = prim[nk]
    P = acc(tw['attributes']['POSITION']); N = acc(tw['attributes']['NORMAL']); UV = acc(tw['attributes']['TEXCOORD_0']); I = acc(tw['indices']).reshape(-1, 3).astype(np.int64)
    st, en = groups_of(I); G = len(st)
    # per-group vertices (a group's triangles may reference non-contiguous vertices: take the unique set), centroid, kind (needle / stem)
    U = [np.unique(I[a:b]) for a, b in zip(st, en)]
    cen = np.array([P[u].mean(0) for u in U]); uu = np.array([UV[u, 0].mean() for u in U])
    needle = uu >= 0.15
    ax = np.array([cen[:, 0].mean(), cen[:, 2].mean()])   # trunk axis ≈ crown centre
    r = np.hypot(cen[:, 0] - ax[0], cen[:, 2] - ax[1]); y = cen[:, 1]
    nb = 24; yb = np.clip(((y - y.min()) / (np.ptp(y) + 1e-6) * nb).astype(int), 0, nb - 1)
    rmax = np.array([np.percentile(r[yb == b], 97) if (yb == b).sum() > 20 else 0 for b in range(nb)]); rmax = np.maximum(rmax, 0.3)
    rn = np.clip(r / rmax[yb], 0, 1.2)
    ao = np.clip(0.55 + 0.45 * np.clip(rn, 0, 1) ** 0.8, 0.55, 1.0)                    # inner crown dark → outer light
    rng = np.random.RandomState(1234 + k); rank = rng.permutation(G)                      # deterministic thinning order (same set for LOD1 ⊂ LOD0)
    # principal axis of every cluster (the direction its needles run) + the data build_cards.py needs
    axis = np.zeros((G, 3), np.float32)
    for g in range(G):
        v = P[U[g]]; d = v - v.mean(0)
        if len(v) > 2:
            w, V = np.linalg.eigh(d.T @ d); axis[g] = V[:, -1]
        else: axis[g] = [0, 1, 0]
    np.savez_compressed(os.path.join(out, 'clusters.npz'), cen=cen.astype(np.float32), axis=axis, ao=ao.astype(np.float32), needle=needle, rn=rn.astype(np.float32), tree_axis=ax.astype(np.float32),
                        ntri=(en - st).astype(np.int32))
    meta = {'groups': int(G), 'needles': int(needle.sum()), 'stems': int((~needle).sum()), 'height': [float(P[:, 1].min()), float(P[:, 1].max())], 'axis': ax.tolist()}
    for lod, tris in BUDGET.items():
        nn = int(needle.sum()); keep_n = 0.0; s = 1.0
        sel = np.zeros(G, bool)
        order = np.argsort(rank)   # needles are NOT kept here: build_cards.py turns the clusters into photo-sprig cards
        stem_idx = order[~needle[order]]; gt = (en - st)[stem_idx]; sel[stem_idx[np.cumsum(gt) <= STEM_BUDGET[lod]]] = True
        pos = []; nrm = []; uv = []; col = []; idx = []; base = 0
        for g in np.where(sel)[0]:
            u = U[g]; c = cen[g]; sc = s if needle[g] else 1.0
            remap = {int(v): i for i, v in enumerate(u)}
            pos.append((P[u] - c) * sc + c); nrm.append(N[u]); uv.append(UV[u])
            col.append(np.tile([ao[g], ao[g], ao[g], 1.0], (len(u), 1)).astype(np.float32))
            idx.append(np.vectorize(remap.get)(I[st[g]:en[g]]) + base); base += len(u)
        np.savez_compressed(os.path.join(out, f'twig_{lod}.npz'), pos=np.concatenate(pos).astype(np.float32), nrm=np.concatenate(nrm).astype(np.float32), uv=np.concatenate(uv).astype(np.float32),
                            col=np.concatenate(col), idx=np.concatenate(idx).astype(np.uint32), scale=s)
        meta[lod] = {'keep': keep_n, 'scale': s, 'tris': int(sum(len(x) for x in idx)), 'verts': int(base)}
    # trunk-type meshes for Blender
    parts = []
    for name, p in prim.items():
        if name == nk: continue
        mat = j['materials'][p['material']]
        d = {'name': name, 'material': {'name': name, 'color': [1, 1, 1, 1], 'doubleSided': True}, 'pos': acc(p['attributes']['POSITION']), 'nrm': acc(p['attributes']['NORMAL']),
             'idx': acc(p['indices']).astype(np.uint32)}
        if 'TEXCOORD_0' in p['attributes']:
            d['uv'] = acc(p['attributes']['TEXCOORD_0']).copy()
            tt = (mat['pbrMetallicRoughness'].get('baseColorTexture') or {}).get('extensions', {}).get('KHR_texture_transform')   # bake the material's UV transform (sapling branches)
            if tt: d['uv'] = (d['uv'] * np.array(tt.get('scale', [1, 1])) + np.array(tt.get('offset', [0, 0]))).astype(np.float32)
        parts.append(d); meta.setdefault('trunk', {})[name] = int(len(d['idx']) // 3)
    write_glb(os.path.join(out, 'trunk_raw.glb'), [{'name': 'trunk_raw', 'parts': parts}])
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    return meta

if __name__ == '__main__':
    asset = sys.argv[1] if len(sys.argv) > 1 else 'fir_tree_01'
    j, _ = read_gltf(os.path.join(HERE, 'src', asset, f'{asset}_1k.gltf'))
    for k in range(len(j['meshes'])):
        m = build_variant(asset, k); print(asset, k, json.dumps(m)[:420])
