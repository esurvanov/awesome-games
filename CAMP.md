# ⛺ CAMP — polar tents · campfire · Kestrel at real size · hab 2k · props

Files: `modules/structures.js` · `worldfill.js` (camp slots, `WorldFill.campFire`) · `open-world.html` FIRE region only ·
`assets/camp/*` (new) · `assets/pack/struct_hab_module.js`, `prop_crate_wood.js` (rebuilt) · `CREDITS.md` ·
look-gate `tools/look/subjects-camp.mjs` + `lg-camp.js` (2-line hook in `tools/look-gate.mjs`) · compare shots in
`tools/compare/cmp-page.js` (+4 shots). Base commit for before/after: `119a2e9`.

## 📊 At a glance

| # | Subject | Before | After | Cost |
|---|---|---|---|---|
| 1 | ⛺ tents | 2× hiking dome 1.3 m + tunnel 1.2 m | 2× polar pyramid 2.3 m (stove tent lit + smoking) | 5.1k tris · 6–7 draws per tent |
| 2 | 🔥 fire | 2 glowing points/frame + flicker light | flipbook flame ×2 crossed, embers, smoke, coal bed, stone glow | +3 draws · 72 smoke puffs · 1 png 65 KB |
| 3 | ✈ Kestrel | 12.75 m hull, 2.46 m wide | 19.7 m hull, 2.83 m wide, trail ×1.55 | 0 (same mesh) |
| 4 | 🏠 hab | 1024² colour, no normal | 2048² colour + 2048² normal (seams, rivets) | pack 0.21 → 1.33 MB · +1 sampler |
| 5 | 📦 crate | 0.04 m (lid only drawn) | whole crate 0.99×0.42×0.49 m | 0 |
| 5 | 🛢 blue drum | 0.49 m across | 0.58 m (55-gal) | 0 |
| 5 | 🛷 sledge | 4.6 m | 4.1 m | 0 |
| 6 | 🏚 station | — | drum depot (6) + loaded sledge | +6 draws |

## ⛺ 1. Polar tents — `polarTentF()` in structures.js

```
square base 2.5 m ─► 4 corner poles to apex 2.3 m ─► canvas sags 19 cm between poles
        │                                                     │
   valance 0.42 m flat on snow ◄── 12 cut snow blocks      sleeve door (+Z), tied
        │                                                     │
   8 guy lines ─► wooden stakes (passable)          stove variant: pipe + rain cap (−X), soot, warm glow
```

| Part | How |
|---|---|
| 🧵 canvas | per-panel atlas `tent_canvas.jpg` (offline, numpy: seams, ridge tapes, dirt, tide marks, patch, sun fade) on `uv1` × Poly Haven *rough_linen* normal + roughness tiles on `uv` |
| ❄ snow | shared rule `ctx.snowCover`: dusting on panels, patchy on valance, blocks fully snow, windward drift heap |
| 🔥 glow | stove tent emissive = canvas map, masked where snow lies on it (saturation test) and lower near the ground |
| 🧱 collider | Passport `st_tent_polar(_stove)` — canvas, blocks, poles, pipe; guy lines, stakes, valance passable |
| 📍 camp | stove tent (0,0), second tent (6.6,1.2); hiking dome removed (sizes.json wants camp tents ≥ 1.9 m) |

## 🔥 2. Campfire — FIRE region of open-world.html

| Piece | Draws | Driven by |
|---|---|---|
| flame: 2 crossed quads, 16-frame flipbook `flame_atlas.png` (512×1024, noise-baked offline, seamless loop), frames cross-faded, edge-on fade | 1 | flicker → height + brightness |
| embers: shared particle pool, ~10/s, buoyant, drift with wind | 0 | wind |
| smoke: 72 instanced camera-facing puffs; station fire + stove pipe (`STRUCT.stove`) + camp ring | 1 | wind dir (terrain) × speed (0.5 + 4.5·storm) |
| heat decal: charcoal coal bed (premultiplied) + warm pool on snow; camp ring smoulders | 2 | flicker |
| stones: ember emissive on the fire-pit inner faces | 0 | flicker |
| point light | — | flicker (0.55–1.25) |

## ✈ 3. Kestrel at real size

| | Before | After |
|---|---|---|
| hull length / width / height | 12.75 / 2.46 / 2.35–2.8 m | **19.7** / 2.83 / 2.7–3.2 m |
| scale | 1 | along ×1.55 · across ×1.15 · wing stub ×1.15 uniform |
| burial | tail 0.3 → nose 1.0 m | tail 0.3 → nose 1.15 m |
| debris trail | 27 m | 42 m (small pieces keep real size; tail/wing sections ×1.15) |

- Uniform ×1.8 rejected: the hull is already DC-3-wide → 4.4 m fuselage.
- Spawn (−23, 210) 13.7 m clear · tool crate 14.8 m clear · cargo door moved out to 8.5 m lateral.

## 🏠 4. Hab module

- NASA publishes **only** the 1024² map (GitHub `NASA-3D-Resources` = science.nasa.gov: same file) → no hi-res source exists.
- Rebuilt: 2048 Lanczos + luminance unsharp · normal map from long straight lines only (seams, hatch edges) + rivet rows + fine grain · text/flags/logos excluded · metal .05 / rough .62 in the file.
- Model unchanged (2.26k tris — nothing to decimate). Procedural bump in `fixHabMat` reduced to broad waviness.

## 📐 5. Sizes vs `tools/qa/sizes.json`

| Kind | Rule | Now |
|---|---|---|
| kestrel | l 16.7–22.6 | ✅ 19.7 |
| st_tent_* | h 1.9–3.2 | ✅ 2.3 (+ pole tips 2.6) |
| crate / prop_crate_wood | h 0.4–0.8 | ✅ 0.42 · crate_wood_02 0.46 · military 0.46 |
| drum | w 0.5–0.66 | ✅ 0.58 / 0.56 |
| st_sledge | l 2.2–4.5 | ✅ 4.14 |
| st_snowcat · pole · propane · generator · firepit | — | ✅ unchanged, in range |

## ⚡ Cost / fps (1512×860 @2x, M1 Pro, shared machine)

| View | Preset | CPU 1× | CPU 4× |
|---|---|---|---|
| camp | high | 38 fps | 48 fps* |
| station fire | high · fire on / off | 61.7 / 61.0 | 39.5 / 44.4 |
| camp | air | see report | |

\* noisy: 5+ other agents queued on the GPU. Fire system: no measurable difference at 1×; at 4× one run +2.8 ms, the
other −0.3 ms → inside noise. CPU work: 72-puff loop + ~10 emits/s.

## 🔒 Checks

| Check | Result |
|---|---|
| `tools/qa/texunits.mjs` 1512×860 @2x | ✅ PASS · 333 programs · max 15 |
| JS errors in all runs | 0 |
| compare `stand/compare-camp/` | station_fire · camp_tents · wreck_side · hab_close · station_props |
| look-gate `stand/lookgate-camp1/` | review.json written (check/accept not run) |

## ❌ Still not matching

- 🔥 close up (≤ 4 m) the flame core blooms into a bright blob; crossed planes read flat from above.
- ⛺ canvas smooth / slightly plastic at 5 m; no tent photo in the reference set.
- ✈ hull atlas stretched ×1.55 lengthwise (panel lines longer than real); baked lighting (assets/baked) still has the
  old wreck footprint → needs a re-bake (NATURE / bake owner).
- 🏠 hab colour is still a soft upscaled photo under the new seams; one side-tank rivet row looks mechanical.
- 🏚 station windows: dome/module glass already warm; hab portholes not lit.
