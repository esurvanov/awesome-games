#!/bin/sh
# tools/trees/build_all.sh — the whole chain: fetch (once) -> clusters/stems -> Blender trunks -> sprig cards -> final GLBs -> game pack -> impostors
# needs: python venv with numpy pillow scipy ($PY), Blender (blender), Chrome. Sources land in tools/trees/src (gitignored).
set -e
cd "$(dirname "$0")/../.."
PY=${PY:-python3}
$PY tools/trees/fetch_ph.py fir_tree_01 fir_sapling_medium
$PY tools/trees/make_textures.py
for A in fir_tree_01 fir_sapling_medium; do
  $PY tools/trees/build_firs.py $A
  for k in 0 1 2; do blender -b --python tools/trees/blender_decimate.py -- tools/trees/out/${A}_$k/trunk_raw.glb tools/trees/out/${A}_$k 1500 3500 500 0.35 >/dev/null; done
  $PY tools/trees/build_cards.py $A
done
$PY tools/trees/assemble_firs.py
$PY tools/trees/pack_firs.py
rm -f tools/trees/out/imp_meta.txt
for L in a b c d e f; do (cd tools && node trees/bake_imp.mjs tree_fir_$L tools/trees/out/final/tree_fir_${L}_l0.glb); done
echo "paste tools/trees/out/imp_meta.txt into IMP_META in modules/vegetation.js"
