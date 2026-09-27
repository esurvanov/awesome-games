# TERRAIN — snow, detail rings, trails, ice

Module `modules/terrain.js` (order −10, runs first) · textures `assets/tr_*.jpg` (3.1 MB) · check tool `tools/terrain-shots.mjs`.
`open-world.html`: only new MODCTX fields (`sea, lakeIce, fpMesh` + forwarders for the four functions below).

## What changed

| Area | Before | Now |
|---|---|---|
| Near ground | one 3.5 m mesh | 4 nested rings, 0.22 → 1.76 m spacing, radius 84 m (*high*), follow the camera, morph into the far mesh |
| Relief | none | smooth (Catmull-Rom) ground + hummocks + wind-aligned sastrugi, fades with ring spacing |
| Snow depth | none | depth field 1024² (0.9 m): wind lee / hollows deeper, windward + steep thin, drifts behind every solid, tree wells |
| Materials | 1 snow + 1 rock, triplanar | fresh snow · wind-packed snow · rock-with-snow · grey cliff (triplanar, snow on ledges) · frozen gravel; height blend |
| Anti-tiling | none | rotated multi-scale sampling (snow, ice), 8-offset no-tile (rock, gravel), macro noise |
| Sparkle | random dots | facets that flash toward the moon / sky |
| Trails | flat decals, fade 45 s | SNOW-CONTACT: objects press a fine 1.6 cm map with their own geometry (real print geometry near the pilot); coarse 128 m × 12.5 cm map follows; blizzard refills |
| Actors | — | pilot (walk/run/landing/roll/slide), fox, stags, skimmer (2 skis + track), snow puffs |
| Sea ice | crack canvas | cracked-plate ice, floes, pressure ridges, snow patches, depth layer |
| Lake ice | crack canvas | clear blue ice, depth layer, cracks, snow at the shore |
| Rock seam | hard line | drift skirt + `snowCover` skirt on boulders / scatter rocks |

Physics heightfield `H` / `getH` untouched. Drawn snow sits on it: loose depth ≤ 0.22 m in the open, ≤ 0.14 m at camps / wreck, ≤ 0.34 m in drifts. Feet sink by `snowDepthAt`.

## API on `ctx` (and `window.Terrain`)

| Call | Returns / does |
|---|---|
| `snowDepthAt(x, z)` | loose snow depth, m (trails compressed) |
| `surfaceAt(x, z, y?)` | `'snow' 'deep_snow' 'ice' 'rock' 'metal' 'wood'` · with `y`: physics ray → object name (kestrel/station → metal, crate/pier → wood) |
| `slopeAt(x, z, r = 1)` | physics slope, degrees (for placing structures: reject > ~30°) |
| `snowCover(matOrObject3D, opts \| amount)` | snow on up-facing surfaces + skirt where the object meets the snow. Any MeshStandard/Physical/Lambert/Phong, instanced, skinned. Idempotent (a 2nd call updates amounts). Chains existing `onBeforeCompile`. +3 texture units |
| `snowContact(x, z)` | `{ s0, floor, dep, surf, press }` — undisturbed snow y (CPU = GPU to ≈ 0.1 mm), compacted floor, loose depth (SNOW-CONTACT.md) |
| `snowFine(x, z)` | 1 inside the fine object-pressed window, 0 outside |
| `snowStamp(...)` / `addFootprint(...)` | shims only (no caller left): prints come from the objects' own geometry — SNOW-CONTACT.md |
| `windDir` | `{x, z}` wind blows toward (same as WorldFill) |

`snowCover` opts: `amount 1 · minUp 0.55 · soft 0.25 · skirt 0.45 (m, 0 = off) · scale 0.35`.

Gameplay: pilot speed × (1 − 0.4 · smooth(0.18, 0.7, depth ahead)) via a wrapper on `PH.ch.move`; walking an existing trail is faster.

## Quality knobs (added to `QUALITY`)

| Knob | low | med | high | ultra |
|---|---|---|---|---|
| `terrainLevels` (0 = rings off) | 3 | 4 | 4 | 4 |
| `terrainGrid` (cells per ring side → radius) | 64 · 56 m | 64 · 56 m | 96 · 84 m | 160 · 140 m |
| `deformRes` (texels) | 512 | 1024 | 1024 | 1024 |
| `deformExt` (m) | 96 | 128 | 128 | 128 |
| `contactRes` · `contactExt` (fine pressed map, SNOW-CONTACT) | 512 · 12.8 m | 768 · 14.4 m | 1024 · 16 m | 1024 · 16 m |
| `contactPatch` · `contactStep` (real-geometry snow patch, m · map texels per quad) | 5 · 2 | 6 · 2 | 7 · 2 | 8 · 1 |
| `contactStatic` (small static props press once) | 1 | 1 | 1 | 1 |

Runtime switch: rings rebuild (no recompile); trail map re-allocates only when res/ext change.

## Measurements (M1 Pro, 1400×800, *high*, vsync; machine shared with other agents' benches)

| View | fps before → after | draw calls | triangles |
|---|---|---|---|
| crash_close | 59.5 → 59.9 | 627 → 407 | 4.02 → 4.74 M |
| crash_wide | 59.9 → 59.9 | 480 → 327 | 3.86 → 4.42 M |
| station | 30 → 59.9 | 541 → 411 | 4.40 → 6.15 M |
| forest | 59.9 → 59.9 | 487 → 353 | 3.51 → 6.51 M |
| boulders | 59.9 → 59.9 | 362 → 260 | 2.33 → 4.08 M |
| rift_rim | 59.9 → 59.9 | 371 → 272 | 3.07 → 4.46 M |
| sea_horizon | 59.9 → 59.9 | 237 → 157 | 1.94 → 2.63 M |
| player_rock | 59.9 → 59.9 | 337 → 231 | 3.39 → 4.00 M |

Collisions 8/8 · JS errors 0 · loader 12/12 · terrain init ≈ 250–300 ms. (Draw-call / triangle changes mostly come from other modules landing between the runs; the station 30 fps "before" was contention.)
Scene-pass GPU time, same view, alternating (`terrain-shots --cost`): terrain module ≈ +5…20 % of the scene pass vs. the original terrain. Biggest fix found: the far mesh under the rings is pushed past the far plane (was shaded under them, ~+30 %).

## Files

- stand: `stand/terrain-before/`, `stand/terrain-after/` (8 views), `stand/terrain-compare.html`
- close-ups: `stand/terrain-after/tr_walk_trail.png · tr_walk_close.png · tr_skimmer_tracks.png · tr_boulder_drift.png · tr_sea_ice.png · tr_lake_ice.png`, numbers in `terrain.json`
- `node tools/terrain-shots.mjs <label> [--cost] [--unlimited] [--modes full,rings_off,old,full:4:128]`

## Known limits

- Trails live only inside the 128 m window around the pilot.
- Objects placed on `groundH` sit 0.1–0.2 m into the snow (intended soft seam); floating / steep-slope ruins are the structures agent's (use `slopeAt`).
- Texture units: rings 13 + shadow + env = 15 of 16.

## FIX-LOOK (2026-09-26)

- Snow albedo near-neutral (tint `.97 .985 1.`, flat `.55 .57 .6`): the blue now comes from the sky light, lit snow B/R 1.2–1.3, shadows bluer.
- Wind-crust normals ×1.8 (crisper sastrugi shading).
- Steep ground: macro noise normal (37 m scale) (gullies / ribs on the 3.5 m far mesh, zero on flat ground so rings and far mesh still meet); the rock-with-snow layer is triplanar below `up .88` (no stretched top-down projection on 20–45° slopes).
- Not done: extra far-mesh geometry (a finer mesh needs a per-vertex fade toward the ring seam — `(fine − coarse) × smoothstep(ringR, ringR + 60, dist)` — left for a later pass).
