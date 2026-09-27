#!/bin/bash
# tools/scan/setup.sh — one-time tool setup for tools/scan (macOS arm64). Everything lands in tools/scan/.bin (gitignored).
#   Blender 4.2 LTS (headless bake/remesh) · basisu (KTX2, built from source with clang, no cmake) · xatlas (UV atlas, pip
#   into .bin/pylib for Blender's Python) · Spark's worker as a same-origin file (vendor/spark-worker-<v>.js).
# Existing installs are reused: BLENDER=/path/to/Blender  BASISU=/path/to/basisu  bash tools/scan/setup.sh
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p .bin; BIN="$PWD/.bin"

# 1. Blender 4.2 LTS
if [ -n "${BLENDER:-}" ] && [ -x "$BLENDER" ]; then ln -sfn "$(cd "$(dirname "$BLENDER")/../.." && pwd)" "$BIN/Blender.app"
elif [ ! -x "$BIN/Blender.app/Contents/MacOS/Blender" ]; then
  V=4.2.9; DMG="$BIN/blender.dmg"
  echo "▶ Blender $V (≈ 300 MB)"; curl -L --fail -o "$DMG" "https://download.blender.org/release/Blender4.2/blender-$V-macos-arm64.dmg"
  MNT=$(hdiutil attach -nobrowse -readonly "$DMG" | awk '/\/Volumes\//{print substr($0, index($0,"/Volumes/"))}' | tail -1)
  cp -R "$MNT/Blender.app" "$BIN/"; hdiutil detach "$MNT" >/dev/null; rm -f "$DMG"
fi
"$BIN/Blender.app/Contents/MacOS/Blender" --version | head -1

# 2. xatlas for Blender's Python
PY=$(ls "$BIN"/Blender.app/Contents/Resources/*/python/bin/python3* | head -1)
[ -d "$BIN/pylib/xatlas" ] || ls "$BIN"/pylib/xatlas*.so >/dev/null 2>&1 || "$PY" -m pip install --quiet --target "$BIN/pylib" xatlas
echo "✓ xatlas"

# 3. basisu (KTX2 encoder)
if [ -n "${BASISU:-}" ] && [ -x "$BASISU" ]; then ln -sf "$BASISU" "$BIN/basisu"
elif [ ! -x "$BIN/basisu" ]; then
  echo "▶ basisu (clang, ~2 min)"; SRC="$BIN/basis_universal"; [ -d "$SRC" ] || git clone --depth 1 https://github.com/BinomialLLC/basis_universal.git "$SRC"
  cd "$SRC"; D="-DBASISU_SUPPORT_SSE=0 -DBASISU_SUPPORT_OPENCL=0 -DBASISD_SUPPORT_KTX2_ZSTD=1 -DBASISU_SUPPORT_ASTCENC=0 -DBASISU_DISABLE_ANDROID_ASTC_DECOMP=0 -DNDEBUG -Wno-everything"
  mkdir -p obj
  for f in $(sed -n '/set(ENCODER_LIB_SRC_LIST/,/^)/p' CMakeLists.txt | grep -E '^\s*(encoder|transcoder)/[^ ]+\.cpp\s*$' | tr -d ' \t\r' | sort -u); do
    clang++ -std=c++17 -O2 $D -c "$f" -o "obj/$(echo "$f" | tr / _).o" & done; wait
  clang -O2 -DNDEBUG -c zstd/zstd.c -o obj/zstd_zstd.c.o
  clang++ -std=c++17 -O2 $D basisu_tool.cpp basisu_text_image.cpp obj/*.o -o "$BIN/basisu"; cd - >/dev/null
fi
"$BIN/basisu" -version | head -1

# 4. Spark worker (artifact CSP: no blob: workers)
ls vendor/spark-worker-*.js >/dev/null 2>&1 || node vendor/make-spark-worker.mjs
echo "✓ ready — node tools/scan/import.mjs <folder>"
