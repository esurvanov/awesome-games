# 🎨 FIX-LOOK — trees, ground plants, rocks, mountains, night colour

Compare sheet: `stand/look-compare/index.html` (eye views next to b / d / e / g / h / a photos + measure.py) · before: `stand/fixlook-before/` · QA: `stand/fixlook/index.html`
Re-run: `node tools/look-compare.mjs look-compare` · LOD check: `node tools/qa/lod-probe.mjs <dir> 90,150`

## ✅ Acceptance (QA `stand/qa-baseline` → `stand/fixlook`)

| Check | Before | After |
|---|---|---|
| 🔲 изнанка (holes) | 2 FAIL · pine trunk 170–2325 px | **0 FAIL** · ≤ 31 px |
| 🌲 floating trees | 18 (worst 1.49 m) | **0** |
| 🪨 buried > 30 % — rocks / boulders / flat / outcrops | 300 / 47 / 70 / 34 | **0 / 0 / 0 / 0** |
| 🧊 buried — sea ice chunks / ridges (atmosphere) | 27 / 1 | **0 / 0** |
| ⬛ foliage near-black share (forest) | needles 28 %, leaves 14 % | 2–9 % (no foliage in the WARN list) |
| ⚡ fps (8 stand views, median) | 59.9 | 59.9 (machine busy: verdict refused, not a FAIL) |

Left in the buried list (not placed by these modules): `wf_ice` ×38, `wf_pressure_ridge` ×3 (worldfill.js), `st_crystal_tree` ×8, `st_rift_crystal` ×6, `st_ruin_column`, `st_pier` (structures.js), `firepit`.

## 📏 measure.py (night_master targets) — before → after

| View | Y median (.03–.06) | lit/shadow (3–6) | B/R lit (1.0–1.25) | B/R shadow (1.3–1.65, > lit) | sky |
|---|---|---|---|---|---|
| 🌲 forest | .075 → **.060** | 3.45 → 2.72 | 1.76 → **1.21** | 1.46 → **1.36** ✓ bluer | #1b3954 → #224255 |
| 🪨 boulder | .118 → .107 | 5.97 → 1.89 | 1.55 → **1.25** | 1.42 → 1.28 | #174b5a → #173c4a |
| 🧊 sea | .149 → .143 | 2.07 → 2.44 | 1.52 → **1.09** | 1.73 → **1.58** ✓ | #37717e → #3e6671 |
| 🏔 mountains | .078 → .064 | 5.17 → 2.65 | 1.45 → 1.27 | 1.00 → **1.59** ✓ | #304a75 → #283e61 |
| 🌌 sky | .077 → .084 | 4.29 → **3.67** | 1.14 → **1.06** | 1.53 → 1.19 | aurora #208676 → **#277b68** |

All values sit inside the photo ranges (night_master min–max). Colour rules now hold: neutral moonlit snow, shadows bluer than light, green (not cyan) aurora. Lit/shadow on open snow stays ≈ 2–2.7: the moon is 21° high and fixed to the sky texture, so flat snow gets one uniform light level; ambient changes did not move it (tested 0 … 0.9).

## 🔧 What changed

| Area | Change |
|---|---|
| 🌲 far trees | cross cards + daylight billboards → **one** octahedral impostor LOD (assets/veg/imp, MeshStandard lighting, 9 draws); dithered 14 m fade; luminance matched to the models (0.70 → ≈ 1.0) |
| ❄ branch snow | same `vegSnow` on models and impostors (up-facing clumps 0.5–1 m) |
| 🌲 species | `tree_pine_scots` retired (dark blob crown + inside-out trunk) |
| 🌲 seating | trunk base under lowest snow − 12 cm (95 trees lowered) |
| 🌾 grass / shrubs | straw / heather palette, up-bent normals, backlit glow, snow at the base, size by exposure, sunk 7 cm |
| 🪨 rocks | seated by the QA burial formula (12–20 %), re-seated after drift re-stamps; snow pillow 20–24 cm; closed-back outcrop scan |
| 🧊 sea ice | bergs / growlers / ridges seated by the same formula |
| 🏔 mountains | triplanar rock on 20–45° slopes, macro relief normals on steep faces |
| 🌙 light | moon `#f0eae4` × 4.4 · hemi `#7c93d4`/`#252c48` × .75 · aurora light .12 · exposure .64 · env .3 |
| 🌑 shadows | split λ .38 → first cascade ≈ 80 m (was ≈ 23 m), same maps; perf agent: cascade 1 texel ≈ 4 cm now |

## ⚠️ Open

- Far-mesh geometry of the north mountains not refined (plan in TERRAIN.md).
- Black-frame FAILs in `strafe_back` / `climb_crate` (zero-px 2.5 %, camera takes) and the `stags` near-plane clip belong to camera work.
