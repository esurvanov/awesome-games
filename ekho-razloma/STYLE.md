# 🎨 STYLE — shared style dictionary

`style.js` → `window.STYLE` · in modules: `ctx.STYLE` (MODCTX). Loaded before the modules.
Every value = what the game **already** uses (read from the code and packs, 2026-09-25). A common vocabulary to migrate to; no new art direction.

| | |
|---|---|
| 🎯 Rule | New or reworked content takes its numbers from `STYLE`, not from literals |
| 🎨 Colours | `hex` = sRGB (as typed in `color: 0x…`) · `lin` = linear (inside shaders) · `STYLE.hex(lin)` / `STYLE.lin(hex)` |
| 🏷 Tags | `STYLE.tag(obj, { owner, source, intentional })` → read by `tools/inventory.mjs` and `tools/eye.mjs` |

## 🧱 Material presets — `STYLE.material(name, overrides?)` → `MeshStandardMaterial`

| Name | Colour | Rough · Metal | Extra | Current source |
|---|---|---|---|---|
| `snow` | `#bdc4d0` | .8 · 0 | lin base `.52 .56 .64`, packed tint `.46 .55 .78` | terrain.js |
| `snow_on_objects` | `#cad3e4` | .88 · 0 | | snowCover / structures snowify |
| `ice_sea` | white + maps | .2 · 0 | env .8 · deep lin `.02 .05 .08` | terrain.js |
| `ice_lake` | white + maps | .1 · 0 | env 1.1 · deep lin `.004 .018 .035` | terrain.js |
| `rock_basalt` | `#8e96a8` | .9 · 0 | desat .55, grade `.62 .68 .80`, lichen .55 | vegetation.js rockMaterialPatch |
| `metal_painted` | `#aebcd2` | .35 · .55 | | Kestrel |
| `metal_bare` | `#888a8f` | .5 · .8 | | station seam steel |
| `metal_dark` | `#2e3542` | .45 · .75 | ⚠️ v1 debris | open-world.html |
| `fabric_suit` | `#e58851` | 1 · 0 | double-sided | pilot_aces (untextured) |
| `fabric_tent` | `#d95a41` | .7 · 0 | | prop_tent_tunnel |
| `wood_weathered` | white + maps | 1 · 0 | | pier, crates |
| `foliage_needle` | white + map | .88 · 0 | alphaTest .42, vertex colours | vegetation.js |
| `bark` | `#e7e4e1` | .95 · 0 | | vegetation.js |
| `foliage_grass` | white + map | .95 · 0 | alphaTest .42 | vegetation.js |
| `glass` | `#34414c` | .08 · .2 | emissive `#ffb468` × .45 | station windows |
| `glass_cockpit` | `#0a1a2c` | .08 · 1 | emissive `#1d9dff` × .5 | Kestrel |
| `crystal` | `#8fc8ff` | .1 · .2 | variants: spire `#1b5fb0`×1 · rift `#4a1a9a`×1.2 · heart `#8a4dff`×1.3 · shard `#ff7a10`×1.1 · shardling `#3a1a9a`×1.5 | structures.js |
| `fur_fox` | `#e8edf5` | .95 · 0 | | fox tint |

## 💡 Light — `STYLE.light(preset)` → `{ moon, hemi, aurora, exposure, bloom }`

| Preset | Moon | Hemi | Aurora light | Bloom | Exposure | Fog near/far |
|---|---|---|---|---|---|---|
| clear_aurora | 2.8 | 1.2 | 0.7 | 0.5 | 0.8 | 90 / 640 |
| calm_mist | 2.4 | 1.35 | 0.35 | 0.62 | 0.82 | 25 / 430 |
| overcast | 1.0 | 1.55 | 0.05 | 0.4 | 0.85 | 45 / 470 |
| blizzard | 1.3 | 1.7 | 0.15 | 0.45 | 0.85 | 6 / 160 |
| aurora_flare | 2.4 | 1.1 | 1.5 | 0.85 | 0.8 | 110 / 720 |
| rift_glow | 2.3 | 1.1 | 0.9 | 0.9 | 0.8 | 60 / 540 |

Fixed: moon `#b4c6ff` · hemi `#7d9de0` / `#2c3c70` · aurora `#5cf5c0` · ACES · glow gain 2.4 · bloom threshold 1.15 · point lights (cd): station 40 · spire 140 · cell 30 · heart 600 · fire 24.
Runtime source stays `ctx.ATMO_PRESETS` (atmosphere.js); `STYLE.atmosphere` mirrors it for new content.

## 📏 Scale — `STYLE.scale` (1 unit = 1 m)

| Thing | Value |
|---|---|
| 🧑 pilot · hermit | 1.9 · 1.84 m |
| 🦊 fox | 0.55 m |
| 🌲 trees (base height × 0.7–1.35) | snow-laden 11.4 · young 6.8 · dense 16.7 · wind-bent 9.4 · krummholz 2.6 · pine 14 · snag 7.6 |
| ❄️ loose snow | open ≤ 0.22 · camp/wreck ≤ 0.14 · drift ≤ 0.34 · boots rest 30 % up |
| 🏗 placement | slope ≤ 20° · masonry sunk 6 cm · walkable ≤ 45° · ledge 0.8–1.6 m |
| 🎥 camera | 7.5 m boom · fov 62 · near 0.1 |

## 🌲 Impostors — `STYLE.impostor`

| | Current bake | Night bake (target) |
|---|---|---|
| Ambient | white × π·0.72 | hemi `#7d9de0` / `#2c3c70` × 1.2 |
| Key | white × 0.9 | moon `#b4c6ff` × 2.8, `MOON_DIR` |
| Correction | runtime gain mid .86 / far .8 | none (gain 1) |
| Storage | lit colour | albedo + normal atlas, lit at runtime (preferred) |
| Layout | 8 views · 256 px cells | same · dither bands 14 m / 30 m |

The current neutral-daylight bake is why far trees read as cardboard next to the moonlit near trees.

## 🏷 Tags for QA

```js
ctx.STYLE.tag(mesh, { owner: 'vegetation', source: 'pack:veg_set', intentional: 'fx' })
```
| Field | Effect |
|---|---|
| `owner` | module column in the inventory (default: file that called `add()`, via `qa-hooks.js`) |
| `source` | provenance (default: `pack:<name>` from `loadPacked`, `primitive:<Box…>`, `generated`) |
| `intentional` | primitive allowed on screen (beam, particle, UI helper) — never reported as a v1 leftover |

## 🌙 Night palette (FIX-LOOK, 2026-09-26)

| Key | Was | Now | Why |
|---|---|---|---|
| moon | `#b4c6ff` | `#f0eae4` | lit snow B/R 1.0–1.2 (night_master) |
| hemiSky / hemiGround | `#7d9de0` / `#2c3c70` | `#7c93d4` / `#252c48` | shadow bluer than lit, B/R 1.3–1.6 |
| auroraA / auroraLight | `#33ffa8` / `#5cf5c0` | `#4dff8e` | aurora `#356c4b`: green, not cyan |
| fog / heightFog | `#1b2b55` / `#22355f` | `#1a2c46` / `#20344f` | sky `#1d3240` |
| straw* / heather* | — | `#aa9778` … `#5a4c48` | grass & shrubs (e02/e05/e06) |

Runtime: atmosphere.js applies moon/hemi colours from these every frame; vegetation.js reads straw/heather.
