#!/bin/bash
# Gate for every refactor step: snapshot diff vs baseline, behaviour probes, full story run.
#   tools/refactor/gate.sh <label> [--quick|--collide]   (--quick skips the ~5 min story run; --collide adds the ~5 min collision net)
# Baseline snapshot: tools/refactor/baseline/base.json (copied to stand/refactor/ when missing).
cd "$(dirname "$0")/../.." || exit 2
L="${1:-step}"; fail=0
mkdir -p stand/refactor; [ -f stand/refactor/base.json ] || cp tools/refactor/baseline/base.json stand/refactor/base.json
echo "── snapshot"
# the snapshot reads settled collision shapes; on a busy machine they sometimes have not settled yet → one retry before calling it a difference
node tools/refactor/characterize.mjs snap "$L" | tail -1
if ! node tools/refactor/characterize.mjs diff base "$L" > /tmp/gate-snap.txt; then
  echo "  (differences, retrying once)"; node tools/refactor/characterize.mjs snap "$L" | tail -1
  node tools/refactor/characterize.mjs diff base "$L" | tee /tmp/gate-snap.txt | tail -8 || true
  grep -q "no differences" /tmp/gate-snap.txt || fail=1
else tail -1 /tmp/gate-snap.txt; fi
echo "── behaviours"; node tools/refactor/behaviours.mjs "$L" > /tmp/gate-beh.txt 2>&1; beh=$?; grep -v '^\[qa\]' /tmp/gate-beh.txt; [ $beh = 0 ] || fail=1   # the probes' own exit code (a pipe into grep would hide it)
if [ "$2" != "--quick" ]; then
  echo "── story"; node tools/autoplay.mjs --out "stand/autoplay-$L" | tail -1 | tee /tmp/gate-story.txt
  # a page that stalls on the very first step under machine load is a flake, not a regression: one retry
  if ! grep -q 'take ok .*0 anomalies.*free ok .*0 anomalies.*saves 13/13' /tmp/gate-story.txt; then
    echo "  (story failed, retrying once)"; node tools/autoplay.mjs --out "stand/autoplay-$L" | tail -1 | tee /tmp/gate-story.txt
    grep -q 'take ok .*0 anomalies.*free ok .*0 anomalies.*saves 13/13' /tmp/gate-story.txt || fail=1
  fi
fi
if [ "$2" = "--collide" ]; then
  echo "── collisions"; node tools/qa/realism.mjs collide --out "stand/refactor/collide-$L.json" > /dev/null 2>&1
  node tools/refactor/collide-compare.mjs "stand/refactor/collide-$L.json" || fail=1
fi
[ $fail = 0 ] && echo "✅ GATE PASS ($L)" || echo "❌ GATE FAIL ($L)"; exit $fail
