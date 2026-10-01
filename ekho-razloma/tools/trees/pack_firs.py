#!/usr/bin/env python3
"""pack_firs.py — tools/trees/out/final/tree_fir_{a,b,c}_l0.glb -> assets/pack/veg_fir_ph.js  (one GLB, 3 species nodes, base64, the game's pack format)"""
import os, sys, base64
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glbio import read_glb, write_glb
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
nodes = []
for L in 'abcdef':
    for lod in ('l0', 'l1'):
        f = os.path.join(HERE, 'out', 'final', f'tree_fir_{L}_{lod}.glb')
        if not os.path.exists(f): continue
        j, acc = read_glb(f); parts = []
        for m in j['meshes']:
            for p in m['primitives']:
                mat = j['materials'][p['material']]
                d = {'name': mat['name'], 'material': {'name': mat['name'], 'color': [1, 1, 1, 1], 'doubleSided': True, 'alphaMode': mat.get('alphaMode')}, 'pos': acc(p['attributes']['POSITION']), 'nrm': acc(p['attributes']['NORMAL']), 'idx': acc(p['indices']).astype(np.uint32)}
                if 'TEXCOORD_0' in p['attributes']: d['uv'] = acc(p['attributes']['TEXCOORD_0'])
                if 'COLOR_0' in p['attributes']: d['col'] = acc(p['attributes']['COLOR_0']); d['quant'] = True; d['uv_q'] = True   # cards: normal int8, uv uint16, colour uint8 (the game widens them to float on load)
                parts.append(d)
        # node tree_fir_<L> = LOD0, tree_fir_<L>_l1 = the lighter LOD used beyond ~12 m (vegetation.js lodMul)
        nodes.append({'name': f'tree_fir_{L}' + ('' if lod == 'l0' else '_l1'), 'parts': parts})
tmp = os.path.join(HERE, 'out', 'veg_fir_ph.glb'); n = write_glb(tmp, nodes)
b64 = base64.b64encode(open(tmp, 'rb').read()).decode()
open(os.path.join(ROOT, 'assets', 'pack', 'veg_fir_ph.js'), 'w').write("(window.__PACK = window.__PACK || {})['veg_fir_ph'] = '" + b64 + "';\n")
print('veg_fir_ph.js', len(b64) // 1024, 'KB (glb', n // 1024, 'KB)')
