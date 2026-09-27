# STRUCTURES — one realistic style for buildings, props, crystals, enemies, boss, snowmobile

Wave-2 agent "structures & style" (2026-09-25). Code: `modules/structures.js` (order 30), `worldfill.js` (sites → slots),
owned regions of `open-world.html`. Models: `assets/incoming2` → `assets/pack/*.js` (26 new packs, base64 GLB).

## What was replaced

| Object | Before | Now | Collider (Passport) |
|---|---|---|---|
| Station | sphere + cylinders + boxes | `struct_station_dome` (door toward the crash site, lit windows) + `struct_station_module` on stilts + 3×2 military-crate stack + drums/crate; NASA hab/radome/dish/rover kept | solid (exact) · drums/crate pushable |
| Camp | lofted tents, box crates, cylinder barrels, box snowcat/sledge, metal mast | `prop_tent_dome` ×2, `prop_tent_tunnel`, `prop_sledge_loaded`, `vehicle_snowcat` (tilted onto the slope), `prop_crate_wood_02` ×4 (one stacked), `prop_drum_plastic_blue` ×2, steel barrel lying, transformer pole | solid without cords/ropes · crates/drums pushable · pole trunk |
| Power line | cylinder poles | scanned `prop_power_pole` / `_transformer` (first pole + camp end), one toppled; wires drawn to the insulators | trunk · fallen = solid |
| Pier + boat | box planks, lofted hull | `struct_pier_wood` sections laid deck-to-deck (deck measured by raycast, 0.2 m above the ice) + `prop_rowboat` frozen in | solid |
| Ruins (4 sites) | chipped boxes / cylinders | `struct_ruin_arch` + 2 × `struct_ruin_column` + `struct_ruin_wall`, scale 1–1.3 | solid |
| Echo ruins (8) | box obelisk + cylinder pillars | arch / wall / column (cycling) + glowing rune decal; site moved to ground ≤ 20° | solid |
| Cairns | stacked icosahedra | `prop_cairn` on hilltops, `prop_inuksuk` on route legs (arms across the path) | solid |
| Spires | octahedra + box pillars + cylinder base | `crystal_spire` ×0.9 on its rock plinth; altar = broken `struct_ruin_column` ×0.5 on the plinth surface; ring/beam/light/part logic kept | solid |
| Rift crystals / crystal trees | 3-octahedron clusters | `crystal_cluster_ground` instances (90 / 184) + 6 `crystal_cluster_large` on the rim | solid (hull) |
| Heart | octahedron | `rift_heart` (7 m, centred) | — |
| Shard pickups | octahedron | `crystal_shard_pickup` (amber) | — |
| Shardling | octahedra | `enemy_shardling` with Idle/Move/Attack/Hit/Death; death → Death clip + physics shards shaped like its own shards | (gameplay hit spheres unchanged) |
| Boss | octahedra + torus | rigged `boss_crystal_golem` (14 clips), glows on bones `chest` / `head` | (unchanged) |
| Skimmer | boxes + cones | `vehicle_snowmobile`: skis steer + follow the ground, track texture scrolls, rider on the seat | physics hover body unchanged |

## Animation mapping

| Enemy state | Shardling clip | | Boss state | Golem clip |
|---|---|---|---|---|
| idle, recover | Idle | | intro | Sleep_End, rises out of the floor |
| chase, return | Move (×1.3 in chase) | | idle / move | Idle · Walk · Run (by speed) |
| windup → dash | Attack (wind-up 0.5 s, thrust ≈ dash) | | rise → drop (slam) | Attack2 ×1.5 |
| hit (flash) | Hit | | charge → volley | Attack1 ×1.7 or Throw_Rock2 ×2.4 (rock shown) |
| killed | Death (1.25 s) + shards | | summon (HP ≤ 50 %) | Throw_Rock ×2.2 |
| | | | hit | Hurt1–3 (cool-down 2.2 s) |
| | | | death | Death (5.8 s) → crumbles into shards |

## Placement (ground fit)

- Every fitted object: 3×3 ground samples over its rotated footprint; nearest spot (spiral ≤ 8–26 m) with terrain slope ≤ 20° and small height spread.
- Upright masonry: base 6 cm below the lowest sample → never floats. Tents/vehicles: pitched/rolled onto the slope.
- Measured over 36 fitted objects: max slope **19.2°**, max float **0.06 m** (masonry) / 0.24 m at one corner (tilted tents), max sink 0.87 m (uphill side of large ruins).
- Validator findings fixed: echo ruins at (138, −215) 56° → moved to 19° spot; at (−76, −151) 53° → 18.6°; station crates floating 0.35 m → removed.

## Gameplay numbers

Unchanged: enemy/boss HP, damage, speeds, hit spheres, boss attack timings, hover physics.
Changed positions: echo sites (moved ≤ 26 m to flat ground), spire altar height follows the plinth (`s.partY`), station drums/crate moved away from the snowmobile spot.
Bench crate for the ledge-climb test: now a 1.2 m stack of military crates at the same spot.

## Hooks (open-world.html ↔ structures.js)

`STRUCT.shardling()` / `STRUCT.dying(e)` · `boss.anim(dt, d)` / `boss.onDeath()` · `sk.seat`, `sk.spray`, `sk.fallback` · `WORLD.station` · spire `s.ax/s.az/s.partY` · `STRUCT.hullProxy(mesh)` · `WorldFill.slots` · `STRUCT.stats` (placed counts, moves, fit report).

## Snow

`ctx.snowCover(material, amount)` is used when the terrain module provides it; otherwise an own patch: up-facing world normals blend to snow (noise-broken edge, rough, non-metal). Applied to buildings, tents, vehicles, ruins, cairns, pier, rowboat, plinths, crates.

## Fixes along the way

- Pushable props (station barrels/crates, camp crates/drums): Rapier `convexHull` crashed ("unreachable") on dense scans → an invisible proxy body of the prop's points clustered to 6 cm; the drawn prop rides on it.
- Merge of glTF parts with quantized UVs → converted to float before merging.

## Measurements (M1 Pro, 1400×800, high)

| | before | after |
|---|---|---|
| Collision tests | 8/8 | 8/8 |
| JS errors | 0 | 0 |
| Loader modules | 12/12 | 12/12 |
| Own draw calls (in-page toggle) | — | +38…+118 per view |
| Own triangles | — | +0.5…0.7 M per view |

| View | fps before → after (vsync) | draw calls | triangles |
|---|---|---|---|
| crash_close | 59.9 → 59.9 | 625 → 407 | 4.01 → 4.73 M |
| crash_wide | 59.9 → 59.9 | 479 → 327 | 3.86 → 4.43 M |
| station | 59.9 → 59.9 | 466 → 412 | 3.07 → 6.27 M |
| forest | 59.9 → 59.9 | 488 → 350 | 3.52 → 5.20 M |
| boulders | 59.9 → 59.9 | 362 → 261 | 2.33 → 3.96 M |
| rift_rim | 59.9 → 59.9 | 371 → 272 | 3.07 → 4.43 M |
| sea_horizon | 59.9 → 59.9 | 237 → 157 | 1.94 → 2.63 M |
| player_rock | 59.9 → 59.9 | 337 → 231 | 3.39 → 4.00 M |

Before/after include the other wave-2 agents' concurrent changes; this module's own share is the in-page toggle row above.
Side by side: `stand/compare.html`. Runs with 3–4 other agents' headless Chromes on the GPU sometimes drop to 30 fps (vsync halving) in both builds.

Screenshots: `stand/struct-after/*.png`, `stand/struct-after-extra/{wf_camp,wf_ruins,climb_crate}.png`.

## Credits added to the menu

Rock Golem — Dm3d; Fire/Ice/Stone Golem — umask007 (CC-BY 3.0, linked) · EZ-Tree © Daniel Greenheck (MIT) · ambientCG.
