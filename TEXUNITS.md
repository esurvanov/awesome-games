# 🎛 TEXUNITS — texture-unit budget: fix, invariant, guard

Files: `modules/terrain.js` (texture arrays) · `modules/vegetation.js` (layer-mask fix) · `modules/groundblend.js`
(runtime guard `texbudget`) · `tools/qa/texunits.mjs` (new) · `tools/qa/qa-page.js` (`QA.texUnits`) · `tools/qa.mjs` ·
`tools/qa/harness.mjs` · `tools/stand.mjs` · `FOUNDATION.md §6b` (budget per family).

## 🔎 Why it kept coming back

```
agent A patch ──► checks A alone ✔        three.js: ONE pool of 16 units per program (vertex + fragment)
agent B patch ──► checks B alone ✔   ──►  sum per compiled program was never checked by anyone
agent C patch ──► checks C alone ✔        → 17…22 units: no link error, only a console line, material draws wrong
```

| # | Where | What happened |
|---|---|---|
| 1 | INT-VEG | crown-AO sampler on trees → reverted |
| 2 | GROUNDBLEND | terrain WIP 17 > 16 → worked around in a worktree |
| 3 | now | terrain 17–22 units (groundblend + baked + SNOW-CONTACT + detail maps) |

The sum is a finite, countable property → closed by a formula check on every compiled program, not by more reviews.

## 📊 Programs over budget — before → after (1512×860 @2x, all 4 presets, 18 views + whole-scene compile)

| Material (mesh) | Units before | After | How |
|---|---|---|---|
| terrain contact patch | 19 · 20 · 22 | 13 · 15 | 9 detail maps → 2 texture arrays |
| terrain detail rings 0–3 | 17 · 18 · 19 · 21 | 12 · 14 | same |
| terrain far mesh | 17 | 10 | same |
| anything else | ≤ 14 | unchanged | — |

- 🧩 **Merged**: `tSFd tSWd tRSd tCLd tGRd` → `tTrD` (sRGB array, 5 layers) · `tSFn tSWn tRSn tCLn` → `tTrN` (4 layers).
  Same 1024² jpgs, same flip, mips, anisotropy 8, repeat. Ground crop diff vs HEAD ≈ 1/255 (snowfall noise).
- ❌ **Dropped**: nothing. The 2D `tSFd/tSFn/tSWd/tSWn` stay for rock snow caps and sea-ice (their own programs).
- 📉 Max program now **15 / 16** (contact patch) — headroom per family: FOUNDATION §6b.

## 🌲 "Trees disappeared": what was actually found

| Check | Result |
|---|---|
| Tree programs over 16? | ❌ never: bark 12, needles 8, impostors 6 (before and after) |
| Near trees drawn, HEAD, 1512×860 @2x, 1400×800 @1x | ✔ close / mid / spawn-far — not reproduced here |
| Objects drawn **only as a shadow** | ✔ **found, 39 meshes at spawn**: Kestrel debris wheel, skin panels, cowling, seat, cargo door, crates, drums, sledges, rocks |

Cause (vegetation.js, draw-call director): a far object gets layer 0 switched off ("tiny"); when another module
then enabled its own layer (groundblend 12, terrain contact), the director took the *whole* mask as the new
baseline → layer 0 lost forever → not in the main pass, still in the cached shadow. Fix: adopt only the bits the
other module flipped. After: **0** wrongly hidden meshes (remaining layer-0-off meshes are the intentional
shadow-only proxies of perf.js).

## 🔒 Invariant (hard FAIL)

| Where | FAIL when |
|---|---|
| `node tools/qa/texunits.mjs [--presets all] [--size 1512x860 --dpr 2]` | any program: total samplers > `MAX_TEXTURE_IMAGE_UNITS`, fragment > 16, vertex > `MAX_VERTEX_TEXTURE_IMAGE_UNITS`; or a `Trying to use N texture units` / `[TEXBUDGET]` line → exit 1 |
| `tools/qa.mjs` | same check, 4 presets, after the eye views → row «texture-unit budget» + exit 1 |
| `tools/stand.mjs` + every `harness.mjs` tool | the console line counts as a JS error; stand exit code 3 |
| game (runtime guard) | one line per material, once: `[TEXBUDGET] material "bark" on "veg_tree_e_bark": 17 texture units > 16 (…samplers)` |

Proof it fails (worktree, then reverted):

| Test | Result |
|---|---|
| HEAD `terrain.js` back | FAIL · 11 programs over · guard names `terrain_detail_0…3`, `terrain_contact_patch`, `terrain` |
| +5 dummy samplers on near trees | FAIL · bark 17 > 16 · guard: `material "bark" on "veg_tree_e_bark"` · stand exit 3 |
| final build, 1512×860 @2x, low/med/high/ultra | ✔ PASS · 323 programs · max 15 · 0 warnings |
| final build, 1400×800 @1x, low/med/high/ultra | ✔ PASS · 311 programs · max 15 · 0 warnings |

## 👁 Screens (third-person, player camera)

| | 1512×860 @2x | 1400×800 @1x |
|---|---|---|
| 🌲 close (5 m) | `stand/texfix1-shots/retina/close-base.png` | `stand/texfix1-shots/1x/close-base.png` |
| 🌲 mid (35–60 m) | `stand/texfix1-shots/retina/mid-base.png` | `stand/texfix1-shots/1x/mid-base.png` |
| 🌌 far (100–250 m) | `stand/texfix1-shots/retina/spawn-far.png` | `stand/texfix1-shots/1x/spawn-far.png` |
| 🏠 station / 🪨 boulder / outcrop | `stand/texfix1-shots/retina/v-*.png` | `stand/texfix1-shots/1x/v-*.png` |

Look-gate `stand/lookgate-texfix1/` (tree_close, forest_mid, forest_far, boulder, snow_open, footprints) — review
written, all `same` or `better`, nothing changed visually by this wave (check/accept not run).

## ⚡ fps (stand.mjs, 1400×800, vsync, quiet machine at the start of each run)

| View | high | low |
|---|---|---|
| 🌲 forest | 59.9 | 59.9 |
| 🛩 crash_close | 59.9 | 59.9 |
| 🪨 boulders | 59.9 | 59.9 |
| 🏠 station | 59.9 | 59.9 |
| verdict · texBudget | PASS · PASS | PASS · PASS |

`stand/texfix1-high/`, `stand/texfix1-low/` · failed requests there (`interact-data.js`, `/api/stats`) belong to
other agents' uncommitted work.

## 🌲 Forest cost — A/B inside one page (1512×860 @2x, high, no vsync)

Machine was shared the whole time (other agents' Chromes, 60–260 % CPU): single samples jump 13 → 50 ms, so only
the steady medians are given.

| Toggle (deep forest, 20+ trees within 30 m) | Frame ms | Δ vs base |
|---|---|---|
| base | 14.9–15.7 | — |
| GroundBlend off | 15.3–15.5 | ≈ 0 |
| snow contact (objects' undersides) off | 14.3–14.9 | ≈ −0.5 |
| baked light off | 14.6–14.9 | ≈ −0.5 |
| crown-AO off | 14.0–16.5 | ≈ 0 |
| near trees hidden | 7.4–10.3 | **−5…−7** |
| moon shadows off | 13.5 | ≈ −1.5 |

- Module CPU per frame (all modules): ≤ 0.8 ms; groundblend top-down render every 3 s (≈ 1 ms), not every frame;
  the contact render draws only moving actors (pilot, animals, props), never trees.
- Same spot, published build `63b9ea8` vs now, same harness: uncapped 14.6–29 ms (old, pixel ratio 1.5) vs
  11–14.7 ms (now, pixel ratio 1); with vsync both 16.7 ms (60 fps) in forest and on open snow.
- ❓ Not reproduced: the comparison page's 8.6–12 fps in the forest. My runs at its exact spot (92.3, 172.3) gave
  ≈ 23 ms uncapped. Its setup differs (cold profile, `AI.quality.set`, screencast running) — worth one run of its
  script with the cast off before blaming a module.
- No toggle in my files costs more than ≈ 0.5 ms; the near trees themselves are the cost (overdraw of needle cards).

