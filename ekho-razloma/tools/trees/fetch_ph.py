#!/usr/bin/env python3
"""fetch_ph.py — download Poly Haven (CC0) conifer models to tools/trees/src/<asset>/ (gitignored, ~1 GB).
   python3 tools/trees/fetch_ph.py fir_tree_01 fir_sapling_medium pine_tree_01
Poly Haven's API / CDN refuse the default Python user agent: curl with a browser-like UA is used."""
import json, os, subprocess, sys
UA = 'Mozilla/5.0 awesome-games-asset-fetch'
HERE = os.path.dirname(os.path.abspath(__file__))

def curl(u, p):
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    if not os.path.exists(p): subprocess.run(['curl', '-sL', '-A', UA, '-o', p, u], check=True)

def main(names):
    for a in names:
        meta = json.loads(subprocess.check_output(['curl', '-sL', '-A', UA, f'https://api.polyhaven.com/files/{a}']))
        g = meta['gltf']['1k']['gltf']; d = os.path.join(HERE, 'src', a)
        curl(g['url'], f'{d}/{a}_1k.gltf')
        for rel, x in g['include'].items(): curl(x['url'], f'{d}/{rel}')
        for k, f in [('twig_diff', 'jpg'), ('twig_alpha', 'png'), ('twig_nor_gl', 'jpg')]:   # the glTF twig texture has no alpha: fetch the maps
            if k in meta: curl(meta[k]['2k'][f]['url'], f'{d}/tex2k/{k}_2k.{f}')
        print(a, 'ok')

if __name__ == '__main__': main(sys.argv[1:] or ['fir_tree_01'])
