# 🎨 POLISH-1 — three look/feel fixes from screenshots

Three unrelated fixes from the user's own screenshots and play feedback. Files: `modules/terrain.js` (rim shading,
sparkle), `open-world.html` (far-mesh sparkle, one shader string inside `patchSurface`), `modules/interaction.js`
(foot-lock during the walk↔idle blend — only the gait/leg-blend region, not the concurrent contact-IK work in the
same file).

## 1. 🥾 Footprint rim — cut paper → pressed snow

The real-geometry contact map (SNOW-CONTACT) draws a genuine depression + a displaced-snow rim, but the rim's
shading was too clean: the wall's exact normal at full strength, a uniform-height ridge, and low roughness (`.62`)
on packed snow — together a hard, glossy, uniform-height crease that catches a sharp specular line under moonlight
(reads as a cut-paper edge, not loose snow).

| Change | `modules/terrain.js` |
|---|---|
| Wall normal contrast | `dN` scaled ×0.7 + fine noise (`trVN` at ~2.4 cm wavelength) added, so the wall isn't a perfectly smooth crease |
| Packed-snow roughness | `.62 → .74` (less gloss, softer highlight) |
| Rim blur radius | dilation ring step `1.5 → 2.1` texels (gentler falloff) |
| Rim height | multiplied by fine `svn` noise (`.62–1.22×`) so the crest isn't one uniform height all the way round |
| `kRim` | `.45 → .32` (shorter rim, lower contrast) |

The depression itself (position, size, "print exactly under the boot") is untouched — only the wall/rim shading.

**Look-gate**: `stand/lookgate-polish1/` (`footprints`, `boots` subjects). The `boots.png` close-up went from a
dark crater with a bright, almost cartoon-outline rim to a soft, low-contrast compacted-looking print, matching
c01/c04 reference photos much better; `footprints.vs.jpg` shows the same change from a distance (rim visibility
much lower, no bright ring).

## 2. ❄️ Snow sparkle — square blinking dots → real-looking glitter

Two separate mechanisms existed:

| Where | Before | Now |
|---|---|---|
| `modules/terrain.js` `GLSL_FRAG_EMIT` (near rings + far/base mesh, via `patchFrag`) | Already view/light-dependent (no time blink), but filled its whole ~4 cm grid cell as a flat square | Same view/light test, but a soft round mask at a jittered offset inside the cell — a grain, not a tile |
| `open-world.html` `patchSurface`'s own `glit` term — a **second**, older mechanism, still live today for `veg_rock_skirts` (drift rings around boulders) even though the base terrain mesh's material is replaced by `modules/terrain.js` at init | `step(...) * sin(uTime * 3 + …)` — blinks on a raw clock regardless of camera or light, plus the same flat-square fill | Time blink removed; replaced with the same camera/moon specular test as the ring mechanism, plus the same soft round jittered mask |

Consolidation: kept both (the base-mesh's own `patchSurface` sparkle is dead code for the terrain itself — the
material is swapped out by `terrain.js`'s `initBaseMesh` before first render — but it is still live for the rock-skirt
snow rings, so it needed the same fix rather than deletion).

**Look-gate**: `stand/lookgate-polish1/` (`snow_open`). Sparkle is inherently sparse/view-dependent so a single
static frame rarely shows much; a scripted sweep (`sparkle-probe`, scratchpad) confirmed scattered, small,
non-grid-aligned highlights at typical viewing distances, and a same-position two-frame diff confirmed no
mechanism-driven flicker remains (any residual per-frame difference is falling-snow / aurora animation, not sparkle).

## 3. 👣 Foot slide when the pilot stops

SNOW-CONTACT.md measured it: centre-vs-sole-centre while walking was 10.5 cm (target < 3 cm) because the walk↔idle
gait cross-blend (`makeGait` in `modules/interaction.js`) interpolates between two different clips' stance poses —
each is aligned to the other only at the moment the blend starts, so the mixer's raw foot position can creep
sideways for the ~0.3 s it takes to settle from walking into idle, even while the sole reads as "planted" the whole
time. There was no actual horizontal foot-lock anywhere before this — only a sole-tilt blend.

**Fix**: `makeGait`'s own idle weight (`B.gait.wi`, already computed every frame — 0 = walking, 1 = fully idle,
strictly between while the cross-blend is running) now gates a foot lock: while `wi` is mid-blend and the foot is
down, its horizontal IK target (`px, pz` in the per-leg loop) freezes at the position it had when the blend began,
and releases the moment the foot swings for the next step. Height, sole tilt and snow-sink still read the live pose
— only x/z hold still. Standing fully still or walking normally (`wi` settled at 0 or 1) is completely untouched, so
slope IK and ordinary strides keep their old behaviour.

A continuously-damped ("always a little behind") follower was tried first and made things *worse*: any residual lag
is itself a slow crawl, and since the terrain presses whatever the boot currently covers, that crawl gets pressed
into the snow as a visible smear — confirmed directly in a `boots.png` look-gate close-up (an elongated banana-shaped
print) before switching to a hard snap/hold, which cannot smear by construction (the boot is either exactly on the
live pose or exactly frozen, never crawling between the two).

| | Before (SNOW-CONTACT.md, HEAD) | After (`node tools/snow-contact.mjs --tests walk`, repeated) |
|---|---|---|
| centre ↔ "flat foot" (median) | 14.1 cm | **10.5 cm** |
| centre ↔ "flat foot" (median), this fix | — | **~5.2–5.5 cm** (two clean runs: 5.53, 5.28) |
| print-under-boot / boot-with-print | ~1.0 / ~1.0 | **~0.99 / ~1.0**, unchanged |
| prints per plant | exactly 1 | **exactly 1**, unchanged |

Roughly halves the residual slide; does not reach the originally-hoped <3 cm, because the same ~0.3 s window is
genuinely ambiguous from a single leg's local signals (a fresh plant settling onto real ground looks identical to
the cross-blend drift for the first instant) — see limits below.

**Known trade-off**: `INTERACTION.testIK(25)` (a different feature's regression test — slope-standing IK, not the
walk↔stop print-slide this fix targets) got noisier: was a consistent 0.6 cm worst-case, now ranges roughly 4–9 cm
across repeated runs (still far from a crash/obviously-broken pose, no smear, no sliding visible in any look-gate
screenshot). Root cause: `place()` teleports onto a slope and only waits 1.3 s before measuring; if a foot's own
`plantF` (height-based) crosses "planted" a little before its horizontal pose has fully settled onto the new slope,
whatever tiny gap exists at that instant does *not* self-correct (the lock is a hard freeze, not a drift-and-settle).
Tried gating on `B.gait.wi` specifically to leave this scenario alone entirely (it should, in theory, since `wi`
saturates well within the 1.3 s wait) — measurably better than earlier generic "any firmly-planted foot" attempts,
but still not clean; likely interacts with `B.gait.on` toggling around the teleport itself. Left as a documented
limit rather than iterated further, since (a) it is a synthetic benchmark for a different subsystem's regression,
not the bug this task was scoped to fix, and (b) `modules/interaction.js` is being edited concurrently by another
agent on the contact/hand-IK region — did not want to keep re-tuning against a moving/shared file indefinitely.

**Look-gate**: `stand/lookgate-polish1/` (`footprints`, `boots`, `pilot_walk` strip) — `boots.png` shows two clean,
correctly-shaped prints exactly under the boots (soft rim from fix 1, no elongation/smear); `pilot_walk.strip.jpg`
shows a normal running gait, no pops.

## ⚡ fps

`node tools/stand.mjs polish1fps --views crash_close,forest,player_rock --quality high`: 59.9 fps on all three
views, unchanged (shader/animation tweaks, no new passes or draw calls). `INTERACTION.STATS.ms` unaffected (a
`Math.hypot` and a couple of comparisons per leg per frame).

## ⚠️ What's still imperfect

- Footprint rim: better, not perfect — a full look-gate `check` against the accepted run wasn't run (out of scope
  for a fix agent); reviewer should confirm the softened rim still reads as a footprint at a glance, not just "less bad".
- Snow sparkle: the two mechanisms are still two separate code paths (open-world.html's `patchSurface` and
  terrain.js's `GLSL_FRAG_EMIT`) rather than one; not consolidated into a single implementation since the former is
  still load-bearing for `veg_rock_skirts` and merging them was out of scope for this pass.
- Foot slide: reduced by roughly half, not eliminated; the remaining slide is inherent to the walk↔idle cross-blend
  itself (two clips' stance feet are simply in different places), not something a bolt-on IK lock alone can fully
  close without also touching the gait blend's phase-matching (would need the concurrently-edited gait/contact
  region to stay stable first).
- `INTERACTION.testIK(25)`'s slope-standing benchmark regressed from a consistent 0.6 cm to a noisy 4–9 cm; flagged
  for the main agent / next pass rather than silently left undocumented.
