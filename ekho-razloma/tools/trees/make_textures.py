#!/usr/bin/env python3
"""make_textures.py — game textures for the Poly Haven firs -> assets/veg/ph/
  needles_atlas.png   RGBA: the left 30 % strip of the twig atlas (needle blades + stem bark), alpha from twig_alpha  (UV u' = u / 0.30)
  trunk_<a|b|c>.jpg + trunk_<a|b|c>_n.jpg   trunk colour / normal (1k)
  bark.jpg + bark_n.jpg                     branch-stub bark (1k)"""
import os, sys, shutil
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(HERE, 'src', 'fir_tree_01'); OUT = os.path.join(ROOT, 'assets', 'veg', 'ph'); os.makedirs(OUT, exist_ok=True)
STRIP = 0.30
d = Image.open(f'{SRC}/tex2k/twig_diff_2k.jpg').convert('RGB'); a = Image.open(f'{SRC}/tex2k/twig_alpha_2k.png').convert('L')
W, H = d.size; w = int(W * STRIP); rgba = d.crop((0, 0, w, H)); rgba.putalpha(a.crop((0, 0, w, H)))
rgba.save(f'{OUT}/needles_atlas.png', optimize=True)
for k in 'ab':   # variant c's trunk mesh has no UV and no texture: it takes trunk_b (cylindrical UV generated in assemble_firs.py)
    shutil.copy(f'{SRC}/textures/fir_tree_01_trunk_{k}_diff_1k.jpg', f'{OUT}/trunk_{k}.jpg'); shutil.copy(f'{SRC}/textures/fir_tree_01_trunk_{k}_nor_gl_1k.jpg', f'{OUT}/trunk_{k}_n.jpg')
shutil.copy(f'{SRC}/textures/fir_tree_01_bark_diff_1k.jpg', f'{OUT}/bark.jpg'); shutil.copy(f'{SRC}/textures/fir_tree_01_bark_nor_gl_1k.jpg', f'{OUT}/bark_n.jpg')
for f in sorted(os.listdir(OUT)): print(f, os.path.getsize(f'{OUT}/{f}') // 1024, 'KB')

# ---- photo-sprig atlas (the crown is built from these, see build_cards.py): crop of the 2k twig atlas, RGBA + normal
CX0, CY1 = int(W * 0.18), int(H * 0.80)
sp = d.crop((CX0, 0, W, CY1)); sp.putalpha(a.crop((CX0, 0, W, CY1))); sp.save(f'{OUT}/sprigs_atlas.png', optimize=True)
n = Image.open(f'{SRC}/tex2k/twig_nor_gl_2k.jpg').convert('RGB'); n.crop((CX0, 0, W, CY1)).save(f'{OUT}/sprigs_n.jpg', quality=88)
d.crop((0, 0, int(W * 0.15), H)).save(f'{OUT}/stem_bark.jpg', quality=88)   # twig stems: the bark strip of the atlas (u / 0.15)
print('sprig atlas', sp.size)

SAP = os.path.join(HERE, 'src', 'fir_sapling_medium')
if os.path.isdir(SAP):
    shutil.copy(f'{SAP}/textures/fir_sapling_medium_branches_diff_1k.jpg', f'{OUT}/sap_bark.jpg'); shutil.copy(f'{SAP}/textures/fir_sapling_medium_branches_nor_gl_1k.jpg', f'{OUT}/sap_bark_n.jpg')
