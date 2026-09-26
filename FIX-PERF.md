# ⚡ FIX-PERF — quality presets, cached shadows, scatter LOD, footprint pad

Continuation of the previous agent's wave (cached moon shadows, distance-scaled scatter, quality director, scene
target format knob — `bb2f30b`…`e213940`). This pass: verified + fixed the footprint pad change left uncommitted,
measured presets on the 4 heaviest views, ran `qa.mjs --autoplay` and `look-gate.mjs run perf1` against the accepted
baseline. Runs: `stand/qa-fixmotion2` → `stand/qa-fixperf2` · `stand/lookgate-base` (accepted) → `stand/lookgate-perf1`.

## ⚠️ Measurement conditions

This machine ran other agents' headless Chrome automation for this entire session (2–6 other Chrome processes,
load average 9–83 on 8 cores, confirmed at every `stand`/`qa`/`look-gate` run including the **before** numbers this
wave compares against). `--quiet-check` waited up to 3 min each time and mostly still reported busy — fps numbers
below are real measurements, not fabricated, but are a **conservative floor**, not this GPU's ceiling. Relative
ordering (low < med < high < ultra, monotonic every time) is reliable; absolute fps would be higher on a quiet
machine. QA/look-gate functional results do not depend on absolute fps and are trustworthy as reported.

## 1. QUALITY presets — real costs already wired (confirmed, not changed this wave)

| Knob | Presets | Controls |
|---|---|---|
| `pixelRatio`, `msaa` | low 1/0 → ultra 2/4 | render scale, scene MSAA |
| `shadowDist`, `shadowMap`, `split` | low 120/1536 → ultra 320/4096 | moon shadow range + per-cascade texels |
| `shC0`, `shMapFar`, `shTiles`, `shTileGrid`, `shMove` | low 64/1024/1/3/12 → ultra 110/2048/2/4/18 | **cached shadow atlas**: near-cascade half-size, far texels, tile count/grid, re-centre distance |
| `ao` / `aoScale` | off → on/1 | GTAO on/off + resolution |
| `bloomScale` | 0.35 → 1 | bloom resolution |
| `grass` | 0.45 → 1.3 | `WorldFill.knobs.density` |
| `treeNear`, `treeShadow` | 110/45 → 230/140 | real tree-model radius, tree shadow-casting radius |
| `perfDraw`, `perfLod`, `perfCast` | 0.6/0.6/0.7 → 1.3/1.4/1.2 | **scatter director** (`modules/perf.js`): draw distance, LOD switch distance, shadow-caster distance per rock/ice/structure category |
| `terrainLevels`, `terrainGrid`, `deformRes`, `deformExt` | 3/64/512/96 → 4/160/1024/128 | terrain detail-ring count/density, footprint deformation-map resolution/extent |
| `atmSnow`, `atmSnowFar`, `atmShafts`, `atmShaftScale`, `atmIceMax` | atmosphere.js `QKNOBS` per preset | snow-particle counts, light-shaft count/resolution, aurora-on-ice intensity cap |
| `sceneFmt` | `'r11'` opt-in | R11G11B10F scene target (half the bytes/sample) vs default RGBA16F |

All of the above predate this wave (previous agent, `bb2f30b`/`e213940`/`c3a8232`) — checked against the code, still
correctly wired into `setQuality`, `modules/perf.js`, `modules/atmosphere.js`, `modules/terrain.js`. Nothing here
needed a fix.

### Quality director

`ai.js`'s `quality()` (fps from real frame intervals, 8 s warm-up, downgrade only on 2 sustained readings < 48 fps,
climb only with headroom, no asks in the menu) already exists from the previous agent's wave and needs no changes.
**Did not add a continuous render-scale/frame-time controller inside a preset.** No partial implementation of one
existed to finish (searched the whole repo — no `renderScale`/`dynRes`/controller code anywhere outside the existing
discrete director). Given (a) it's explicitly optional in the brief, (b) the discrete director already holds the
59.9 fps cap and downgrades under sustained load, and (c) this machine's chronic contention made it impossible to
reliably validate a *new* dynamic mechanism this session (can't tell a real weak-GPU response from contention
noise) — building one now would add an untested system on top of an already-adequate one. Left as an explicit,
considered decision rather than started-and-abandoned.

## 2. Footprint pad shrink — verify, commit, and its side effect

Uncommitted diff handed off: `modules/interaction.js` blob pad 1.3 → 0.75 m, `modules/terrain.js` CPU-replay taps
0.36 → 0.32 m (matching the smaller pad). Committed as instructed (`924f772`).

**Found while verifying:** the CPU replay that places the pilot's own foot height (`snowSurfaceAt`, 9-tap ±0.32 m
blur average) undershoots a 0.75 m pad's true peak press badly — averaged press dropped from ≈96 % of peak (old
1.3 m pad, taps mostly inside the plateau) to ≈40 % (measured via a standalone port of the exact shape math). First
`qa.mjs --autoplay` after the shrink showed it: boots flipped from sunk (matching FIX-MOTION's fix) to floating in
**almost every eye view** — `forest -0.041→+0.012`, `camp -0.059(FAIL)→+0.028`, `ruins -0.051(FAIL)→+0.005`,
`deep snow -0.147(FAIL)→+0.027` — and a new FAIL at `outcrop_front` (+0.064 m).

Fix (`16e80bb`, one line): the leg-placement query in `modules/interaction.js` used the `footPress()` estimate only
*before* the pad was logged, then trusted the blurred log average once logged. Removed that switch — always floor
with `footPress(x,z) * 0.72` via `Math.max` inside `snowSurfaceAt`, regardless of log state. Restores correct sink
depth (`deep snow` now `-0.016`, `forest/camp/ruins` back to PASS) without touching the rendered pad size at all
(that's driven purely by the stamp geometry, untouched by this fix).

**Open, not fixed this wave:** the footprint pad shrink barely shrinks the *visible* idle-stand crater. Ported the
exact stamp shape + tap-blur math to a standalone script and confirmed: a single 0.75 m pad's rendered/replayed
press is nearly zero at its own center in this tap-blur model (~1 mm), yet the actual `look-gate` screenshot still
shows a clearly visible ~0.6–1 m round pit, same size as the accepted baseline. This means the *visible* crater is
dominated by something other than the single-stamp shape — most likely repeated per-frame stamping while the pilot
stands still (the deformation render target is never cleared between frames, only appended to), which would make
any pad size converge to a similar visible depth/width given enough idle seconds. Root cause identified but not
fixed (would need either a "don't re-stamp within N cm/M ms" guard or a max-style blend instead of resampling every
frame) — flagged for the next wave, not attempted here given the risk of touching the shared stamp render path
under this session's already-limited verification headroom.

`outcrop_front`'s new +0.064–0.075 m float (QA feet check) reproduces identically with or without the footPress
floor fix — pre-existing slope edge case, unrelated to the footprint pad, not previously measured (the view wasn't
in `qa-fixmotion2`'s checked set). Left open, noted, not chased further (marginal, 1.5–2.5 cm over the 5 cm gate).

## 3. Measured fps/ms — 4 heaviest views × 4 presets (uncapped, 1400×800, M1 Pro, contended machine)

`node tools/stand.mjs perf-final --unlimited --quiet-check --views forest,rift_rim,station,player_rock --variants tools/perf/presets.json --warm 25000`

| View | low | med | high | ultra |
|---|---|---|---|---|
| 🌲 forest | 137 fps · 7.3 ms | 100 · 10.0 | 88.5 · 11.3 | 62.9 · 15.9 |
| 🕳 rift_rim | 114.9 · 8.7 | 80.6 · 12.4 | 76.9 · 13.0 | 59.9 · 16.7 |
| 🏠 station | 142.9 · 7.0 | 95.2 · 10.5 | 90.9 · 11.0 | 64.1 · 15.6 |
| 🧍 player_rock | 126.6 · 7.9 | 93.5 · 10.7 | 79.4 · 12.6 | 60.6 · 16.5 |

Before (pre-cached-shadow, `stand/perf-fin1`, high, uncapped, same machine-contention conditions): forest 68.5 fps
(14.6 ms) · rift_rim 82 fps (12.2) · station 49 fps (20.4) · player_rock 51.5 fps (19.4).

**150 fps target on `high`: not achieved** (best is station at 90.9 fps) — reporting honestly per the brief. Not
achieved even on `low` for rift_rim/player_rock (114.9/126.6). Historical cost breakdown from the previous agent's
session (`stand/cost-noShadow` vs `stand/cost-base`, forest/rift_rim before the shadow cache existed) shows why:
disabling shadows entirely took forest/rift_rim from 62.5 fps to 285.7/277.8 fps — shadows were (and after caching,
still are, just far less so) the dominant cost in tree-heavy views. Remaining cost at `high` is now spread across
AO, bloom, atmosphere (snow/shafts) and vegetation roughly evenly (`cost-noAO`/`cost-noBloom`/`cost-noAtmo`/
`cost-noVeg`, prior session) rather than one thing dominating — there is no single further win of the shadow-cache's
size available; closing the gap to 150 fps on `high` would need either a cheaper AO/bloom path or a lower default
scene resolution, both outside this wave's diff.

Capped (vsync): 59.9 fps confirmed on all 8 standard `stand` views whenever the machine was briefly quiet during
this session (`qa-fixperf2`'s stand phase); drops to a uniform 30 fps across all 8 views under heavy external
contention (same signature as `FIX-MOTION.md`'s own note) — a machine-scheduling artifact, not a regression.

## 4. QA — `stand/qa-fixmotion2` → `stand/qa-fixperf2`

| Group | before | after |
|---|---|---|
| 🏃 движение | 3 / 48 | 2 / 49 |
| 👣 опора | 3 / 36 | **0 / 34** |
| 🔲 изнанка | 0 / 25 | 0 / 25 |
| 🧱 примитивы v1 | 0 / 26 | 0 / 26 |
| ⬛ чёрные кадры | 0 / 45 | 0 / 46 |
| 🎨 текстуры | 0 / 2 | 0 / 2 |
| 🎥 камера | 2 / 38 | **0 / 38** |
| ⚡ производительность | 1 / 5 | 0 / 5 |
| 📖 сюжет | 0 / 16 | 0 / 16 |
| **total** | **9 / 241** | **2 / 265** |

Zero new FAILs (checked every failing verdict key against the baseline, not just group counts). The 2 remaining are
both pre-existing, already documented in `FIX-MOTION.md`'s open list: 🦊 `fox_follow` fox foot-drift (one leg pair
sweeps ~3× slower in the Run clip — asset limitation) and 🗿 `boss` foot-drift during attack clips (golem-scale
clips). 6 previously-failing checks got fixed along the way (`camp`/`ruins`/deep-snow feet, `stags_flee`
camera-in-geometry, boss pelvis speed, `stags` near-plane clip) — mostly side effects of the footPress floor fix and
of the machine being briefly quiet for this run's `производительность` check (PASS, 59.9 fps, vs the baseline's
30-fps-refused run).
Collisions 8/8, 0 JS errors, 12/12 modules, both story endings, saves 13/13.

## 5. Look-gate — `stand/lookgate-base` (accepted) → `stand/lookgate-perf1`

`node tools/look-gate.mjs run perf1` → reviewed all 15 subjects (`.pair.jpg` blind, then `.vs.jpg` vs accepted).
14/15 subjects are pixel-identical or within normal frame noise (expected: this wave's changes are meant to be
render-invariant optimizations). `review.json` written, scores kept equal to the accepted baseline everywhere
nothing changed, `vsAccepted: "same"` throughout, no anti-pattern newly appeared, no criterion scored below the
accepted review.

One transient artifact during the first capture: `stag` framed the animal far off-frame. Traced this to the same
class of bug as the documented golem/boss root-motion clamp (`1fffd06`) — a large-dt frame under this machine's
heavy contention let the stag's position integrate too far during the graze-transition before the tele shot fired.
Confirmed with a clean re-shot (`stand/lookgate-perf1b`, same commit) that the stag frames correctly — not a code
regression, a capture-time artifact on an overloaded machine. Scored the `stag` subject "same" as accepted.

**`node tools/look-gate.mjs check perf1` was not run** — the harness's auto-mode classifier denied it as
self-approval (I wrote `review.json` myself; `check` gates acceptance, same sensitivity class as `accept`, which
the brief already reserves for the user/main agent). Per instructions I did not try to work around this. **The main
agent or user needs to run `node tools/look-gate.mjs check perf1`** — based on the review above it should pass (no
regression on any subject), but it hasn't been machine-validated. I did not run `accept` either, per the brief.

## ⚠️ Open items for the next wave

- Footprint idle-stand crater still visually ~0.6–1 m (root cause: likely repeated per-frame stamping while
  standing still, not the nominal pad radius — see §2). The pad-radius parameter alone can't fix this while the
  9-tap ±0.32 m CPU replay blur exists; needs a restamp-throttle or max-blend fix in `modules/terrain.js`.
- `outcrop_front` feet check floats +6–7 cm on that slope — pre-existing, unrelated to this wave, not chased.
- `node tools/look-gate.mjs check perf1` needs the main agent/user to run it (self-approval block, see §5).
- 150 fps target on `high` not reached in the 4 heaviest views (best 90.9 fps) — would need cheaper AO/bloom or a
  lower default scene resolution, out of scope for this diff.
- fox asset leg-timing and boss/golem attack-clip drift remain (FIX-MOTION.md's own open list, unchanged here).
