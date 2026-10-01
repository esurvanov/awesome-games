#!/usr/bin/env python3
"""assemble_firs.py — final per-variant GLBs (needles + decimated trunk) -> tools/trees/out/final/tree_fir_<k>_l<0|1>.glb
Materials: needlesPH (twig atlas, alpha), barkPH, trunkPH<a|b|c>, deadPH. Needle UVs are remapped to the cropped atlas (u / 0.30)."""
import os, sys, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import read_glb, write_glb
HERE = os.path.dirname(os.path.abspath(__file__)); STRIP = 0.30
OUT = os.path.join(HERE, 'out', 'final'); os.makedirs(OUT, exist_ok=True)
# (asset, variant) -> species letter; fir_tree_01 = tall scans (sparse crowns), fir_sapling_medium = dense conical young firs
SPECIES = [('fir_tree_01', 0, 'a'), ('fir_tree_01', 1, 'b'), ('fir_tree_01', 2, 'c'), ('fir_sapling_medium', 0, 'd'), ('fir_sapling_medium', 1, 'e'), ('fir_sapling_medium', 2, 'f')]

from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

def thin_islands(d, keep, seed):
    """keep a share of the loose islands (branch stubs) of a mesh part; keep 0 -> one degenerate triangle (the LOD slot stays, nothing draws)"""
    P = d['pos']; I = np.asarray(d['idx']).reshape(-1, 3)
    if keep <= 0:
        d2 = dict(d); d2['pos'] = np.zeros((3, 3), np.float32); d2['nrm'] = np.tile([0, 1, 0], (3, 1)).astype(np.float32); d2['idx'] = np.array([[0, 1, 2]], np.uint32)
        if 'uv' in d: d2['uv'] = np.zeros((3, 2), np.float32)
        return d2
    n = len(P); rows = np.concatenate([I[:, 0], I[:, 1]]); cols = np.concatenate([I[:, 1], I[:, 2]])
    nc, lab = connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)), directed=False)
    rng = np.random.RandomState(seed); keep_c = rng.rand(nc) < keep; tri_keep = keep_c[lab[I[:, 0]]]
    I2 = I[tri_keep]; used = np.unique(I2); remap = -np.ones(n, np.int64); remap[used] = np.arange(len(used))
    d2 = dict(d); d2['pos'] = P[used]; d2['nrm'] = np.asarray(d['nrm'])[used]; d2['idx'] = remap[I2].astype(np.uint32)
    if 'uv' in d: d2['uv'] = np.asarray(d['uv'])[used]
    return d2

def trunk_parts(path, letter, asset, lod='l0'):
    j, acc = read_glb(path); parts = []
    for m in j['meshes']:
        for p in m['primitives']:
            mat = j['materials'][p['material']]['name']; nm = mat.split('.')[0]
            kind = 'barkPS' if asset == 'fir_sapling_medium' else 'barkPH' if (nm.startswith('bark') or nm.startswith('dead')) else 'trunkPH' + ('b' if letter == 'c' else letter)
            d = {'name': kind, 'material': {'name': kind, 'color': [1, 1, 1, 1], 'doubleSided': True}, 'pos': acc(p['attributes']['POSITION']), 'nrm': acc(p['attributes']['NORMAL']), 'idx': acc(p['indices']).astype(np.uint32)}
            if 'TEXCOORD_0' in p['attributes']: d['uv'] = acc(p['attributes']['TEXCOORD_0'])
            else:   # variant c's trunk: cylindrical UV around the tree axis (3 wraps round, 0.6 per metre up)
                P = d['pos']; c = P[:, [0, 2]].mean(0); ang = np.arctan2(P[:, 2] - c[1], P[:, 0] - c[0]); d['uv'] = np.stack([ang / (2 * np.pi) * 3.0 + 0.5, P[:, 1] * 0.6], 1).astype(np.float32)
            if kind == 'barkPH' and nm.startswith('bark'): d = thin_islands(d, 0.5 if lod == 'l0' else 0.0, 5)   # branch stubs: half at LOD0, none beyond
            parts.append(d)
    return parts

for asset, k, letter in SPECIES:
    src = os.path.join(HERE, 'out', f'{asset}_{k}')
    if not os.path.exists(os.path.join(src, 'cards_l0.npz')): continue
    sap = asset == 'fir_sapling_medium'; bk = 'barkPS' if sap else 'barkPH'
    for lod in ('l0', 'l1'):
        c = np.load(os.path.join(src, f'cards_{lod}.npz'))
        cards = {'name': 'needles', 'material': {'name': 'needlesPH', 'color': [1, 1, 1, 1], 'doubleSided': True, 'alphaMode': 'MASK'}, 'pos': c['pos'], 'nrm': c['nrm'], 'uv': c['uv'], 'col': c['col'], 'idx': c['idx']}
        z = np.load(os.path.join(src, f'twig_{lod}.npz')); uv = z['uv'].copy(); uv[:, 0] = np.clip(uv[:, 0] / 0.15, 0, 1)
        stems = {'name': 'stems', 'material': {'name': bk, 'color': [1, 1, 1, 1], 'doubleSided': True}, 'pos': z['pos'], 'nrm': z['nrm'], 'uv': uv, 'idx': z['idx']}
        parts = [cards, stems] + trunk_parts(os.path.join(src, f'trunk_{lod}.glb'), letter, asset, lod)
        n = write_glb(os.path.join(OUT, f'tree_fir_{letter}_{lod}.glb'), [{'name': f'tree_fir_{letter}', 'parts': parts}])
        print(f'tree_fir_{letter}_{lod}.glb', n // 1024, 'KB', {p['name'] + str(i): np.asarray(p['idx']).size // 3 for i, p in enumerate(parts)})
