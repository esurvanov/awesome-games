#!/bin/bash
# Gate for every refactor step: snapshot diff vs baseline, behaviour probes, full story run.
#   tools/refactor/gate.sh <label> [--quick]     (--quick skips the ~5 min story run)
# Baseline snapshot: tools/refactor/baseline/base.json (copied to stand/refactor/ when missing).
cd "$(dirname "$0")/../.." || exit 2
L="${1:-step}"; fail=0
mkdir -p stand/refactor; [ -f stand/refactor/base.json ] || cp tools/refactor/baseline/base.json stand/refactor/base.json
echo "── snapshot"; node tools/refactor/characterize.mjs snap "$L" | tail -1 && node tools/refactor/characterize.mjs diff base "$L" || fail=1
echo "── behaviours"; node tools/refactor/behaviours.mjs "$L" | grep -v '^\[qa\]' || fail=1
if [ "$2" != "--quick" ]; then
  echo "── story"; node tools/autoplay.mjs --out "stand/autoplay-$L" | tail -1 | tee /tmp/gate-story.txt
  grep -q 'take ok .*0 anomalies.*free ok .*0 anomalies.*saves 13/13' /tmp/gate-story.txt || fail=1
fi
[ $fail = 0 ] && echo "✅ GATE PASS ($L)" || echo "❌ GATE FAIL ($L)"; exit $fail
