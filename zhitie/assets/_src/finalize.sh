#!/bin/bash
# finalize.sh in.glb out.glb [smallPattern] [bigSize] [smallSize] [jpeg:1/0]
set -e; cd "$(dirname "$0")/.."; T=$PWD/node_modules/.bin/gltf-transform
in=$1; out=$2; small=$3; bs=${4:-1024}; ss=${5:-512}; jp=${6:-1}
$T resample "$in" tmpf_1.glb >/dev/null
$T resize tmpf_1.glb tmpf_2.glb --width $bs --height $bs >/dev/null
if [ -n "$small" ]; then $T resize tmpf_2.glb tmpf_2.glb --width $ss --height $ss --pattern "$small" >/dev/null; fi
if [ "$jp" = 1 ]; then $T jpeg tmpf_2.glb tmpf_3.glb --quality 85 --formats "*" --slots "{baseColorTexture,normalTexture,metallicRoughnessTexture,occlusionTexture}" >/dev/null; else cp tmpf_2.glb tmpf_3.glb; fi
$T prune tmpf_3.glb "$out" >/dev/null; rm -f tmpf_*.glb
ls -la "$out" | awk '{print $5, $9}'
