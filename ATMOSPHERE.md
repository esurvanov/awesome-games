# ATMOSPHERE — sky, fog, weather looks, horizon

`modules/atmosphere.js` (one file, order −10 → its `update` runs **last** of all modules, so its fog/light values win).
Switch off for A/B: `open-world.html?noatmo`.

## 1 · What changed

| Area | Before | Now |
|---|---|---|
| 🏔 Horizon | procedural ridge rings (`wf_mountains`, untextured) | real-heightmap ring `env_mountain_ring` ×2 (1290–1650 m and 1950–2500 m), baked snow/rock, aerial haze → fog colour exactly at sea level (no seam with the ice), moonlit rim, vanishes in a blizzard |
| 🧊 Sea ice | procedural slabs only | + 9 large · 9 tabular · 28 small bergs · 31 pressure-ridge segments (9 chains) · 90 growlers from `incoming2`, placed only on free sea ice, 25 instanced meshes (6 sectors per model), 44 `solid` colliders inside the reachable ring |
| 🌫 Fog | linear fog, one colour | + height fog (analytic, hugs sea / lake level / valleys) + moon in-scatter (fog brightens toward the moon) in **every** built-in material |
| 🌌 Sky | aurora seam behind the camera | seamless aurora, exposure, cloud veil (overcast/blizzard), moon halo in haze |
| 🌙 Light shafts | — | screen-space god rays from the scene depth, half-res, only when the moon is near the view |
| ✨ Ice | env reflections only | + sharp aurora curtains reflected in sea and lake ice (fresnel) |
| ❄ Snow | 1 layer, 1400 CPU points | 2 GPU layers: near quads (26 m box, motion streaks in a blizzard) + far flakes (110 m box); 0 CPU cost |
| 💨 Breath | — | vapour puffs from the pilot (faster when running) and stags within 70 m |
| 🧱 Light bake | — | `bakeAO`: sky-visibility + contact AO into vertex colours of static structures (`wf_stone`, `wf_built`), 6000 verts/frame after load |
| 🎛 Looks | fog/sky driven ad hoc by `WX` | 6 presets, smooth blending, auto-selection from game state |

## 2 · Presets

| Name | Look | Fog near/far · height fog | Aurora | Moon · hemi | Bloom | Snow · wind | Shafts |
|---|---|---|---|---|---|---|---|
| `clear_aurora` | default night | 90/640 · light | 1.0 green/violet | 2.8 · 1.2 | 0.5 | 0.3 · 1 m/s | ● |
| `calm_mist` | still, misty, moon glow | 25/430 · dense (0.045) | 0.45 | 2.4 · 1.35 | 0.62 | 0.12 · 0.25 | ●●● |
| `overcast` | cloud veil, grey, no stars | 45/470 · medium | 0.06 | 1.0 · 1.55 | 0.4 | 0.55 · 3 | — |
| `blizzard` | whiteout, streaking snow | 6/160 · dense | 0.22 | 1.3 · 1.7 | 0.45 | 1.0 · 22 + streaks | — |
| `aurora_flare` | bright cycling aurora | 110/720 · thin | 2.2 + hue cycle | 2.4 · 1.1 | 0.85 | 0.2 · 0.6 | ● |
| `rift_glow` | violet haze near the Rift | 60/540 · violet | 0.9 violet/pink | 2.3 · 1.1 | 0.9 | 0.3 · 0.8 | ● |

Every preset also sets sky exposure, stars, veil, storm mix, aurora light, tone-mapping exposure, mountain haze, ice-reflection strength, breath amount. Table: `ctx.ATMO_PRESETS` (editable at runtime; `setAtmosphere` re-reads it).

## 3 · API (added to `ctx` / MODCTX)

```js
ctx.setAtmosphere(name, seconds = 4, hold?)   // preset name | 'auto'; hold = seconds before returning to 'auto'
ctx.atmosphere        // { name, auto, manual, weights: { base, rift, mist, blizzard }, params, presets, hidden, stats }
ctx.ATMO_PRESETS      // preset table
ctx.bakeAO(mesh, { min, contact, strength }?)  // once per geometry; mesh needs a 'color' attribute
```
`MODCTX.ENV` was added to open-world.html (the sky environment; the module sets `ENV.dirty` when a look changes, ≤ every 2 s).

**Auto mode** (default) — chain of blends, each smooth:

```
G.ending 'take' / G.aurora < 0.5 ─► overcast
G.ending 'free' / G.aurora > 1.5 ─► aurora_flare          (story)
otherwise clear_aurora ─► + rift_glow  (camera 150→25 m from the Rift)
                        ─► + calm_mist (near the lake · slow 20-min cycle)
any base ─► + blizzard × WX.storm                          (weather)
```

`setAtmosphere('blizzard')` also starts a game blizzard (`WX.target = 1`) and returns to auto when the game ends it; any other manual preset ends a running one.

**AI event director** (AI.md): the existing events already route here — `blizzard` (`WX.target = 1`) → blizzard look, `aurora_flare` (`G.aurora = 2.2`) → aurora_flare look. For new atmosphere events call e.g. `ctx.setAtmosphere('calm_mist', 8, 90)` / `('overcast', 10, 120)`; names = the table above.

## 4 · Quality knobs (added to `QUALITY`)

| Knob | low | med | high | ultra |
|---|---|---|---|---|
| `atmSnow` near flakes | 700 | 1500 | 2400 | 3200 |
| `atmSnowFar` far flakes | 1500 | 3200 | 5200 | 7000 |
| `atmShafts` ray samples (0 = off) | 0 | 14 | 22 | 32 |
| `atmShaftScale` ray target | 0.35 | 0.4 | 0.5 | 0.5 |
| `atmIceMax` ice-reflection cap | 0.5 | 0.8 | 1 | 1 |
| `aoScale` (GTAO resolution) | — | **0.35** (was 0.5, baked AO covers structures) | — | — |

All knobs are counts / sizes / uniforms: no shader recompiles on `setQuality`.

## 5 · What is hidden (never deleted)

| Object | Owner | Why |
|---|---|---|
| `wf_mountains` mesh (`visible = false`) | worldfill.js | replaced by the mountain ring |
| game `SNOW` points (1400, `visible = false`; the game still updates them) | open-world.html | replaced by the two snow layers |

Procedural bergs/floes in `wf_seaIce` stay (one merged mesh with the floes); model bergs go only where that mesh, other colliders and POIs leave room.

## 6 · Shader patches (for other agents)

- `THREE.ShaderChunk.fog_*` replaced at init: adds `varying vec3 vAtmW` (world position from `mvPosition`) and uniforms `atmHF`, `atmHC`, `atmMD` (plain objects shared from `ShaderLib`/`UniformsLib.fog`). Custom `ShaderMaterial`s with `fog: true` must include **both** `fog_pars_vertex` + `fog_vertex` and `fog_pars_fragment` + `fog_fragment` (as worldfill does). Missing uniforms read 0 → height fog off, normal fog unchanged.
- Sky dome material: fragment shader replaced (same uniforms + `uExp uStarK uVeil uScat uMoonDir`).
- Sea (5000 m plane) and lake ice (circle r 49): `onBeforeCompile` chained (the previous hook runs first), injected before `fog_fragment`. Re-applied every 5 s if the material is swapped.

## 7 · Measurements

M1 Pro, 1400×800, *high*, `node tools/stand.mjs atmo-before` / `atmo-after` (`stand/compare.html`). Other agents ran GPU benchmarks at the same time, so vsync fps is only meaningful when no other headless Chrome runs (the log notes it).

| View | fps before (vsync) | fps after (vsync, run 1: 1 other Chrome) | draw calls before → after | triangles before → after |
|---|---|---|---|---|
| crash_close | 59.9 | 59.9 | 625 → 719 | 4.01M → 5.60M |
| crash_wide | 59.9 | 59.9 | 495 → 596 | 4.59M → 5.98M |
| station | 59.9 | 59.9 | 566 → 689 | 5.65M → 9.17M |
| forest | 59.9 | 59.9 | 511 → 623 | 5.48M → 9.67M |
| boulders | 59.9 | 59.9 | 362 → 567 | 2.33M → 7.51M |
| rift_rim | 59.9 | 59.9 | 371 → 563 | 3.07M → 8.08M |
| sea_horizon | 59.9 | 59.9 | 237 → 361 | 1.94M → 4.27M |
| player_rock | 59.9 | 59.9 | 337 → 515 | 3.39M → 8.51M |

Call/triangle growth between the runs is mostly other agents' modules landing in between (vegetation, structures); this module adds ≈ +35 calls / +0.45M triangles.
Later reruns under 2–5 concurrent benchmark browsers dropped to 30 fps on some views **with and without** the module (`?noatmo` A/B: identical 30 / 30), i.e. machine load, not this module. Uncapped A/B was too noisy to split finer (same config swung 33 ↔ 79 fps).
0 JS errors from this module; collision bench 7/8 (the failing test also fails with `?noatmo`).

Module cost by part (sea view, uncapped, best of 4, noisy): sky shader and mountains are the largest; ice instancing, snow, breath, shafts are within noise.
Draw calls: +2 mountains, +≤25 ice sectors (+ shadows for ridges/growlers/small bergs), +2 snow, +1 breath, +2 full-screen (shafts, only when the moon is in view). Triangles: +36k mountains, +426k ice (split in sectors, culled per sector).

## 8 · Screenshots

- `stand/atmo-before/*.png`, `stand/atmo-after/*.png` — the 8 bench views.
- `stand/atmo-presets/contact_sheet.jpg` — all 6 presets × 3 cameras on one sheet.
- `stand/atmo-presets/<preset>__<shot>.png` — every preset from 3 cameras (`sea` coast → mountain ring, `moon` forest facing the moon, `rift`). Made with `node tools/atmo-shots.mjs atmo-presets` (also `--prof sea --unlimited` for per-part fps, `--qualities high,med,low`).

## 9 · Known issues

- Additive snow/breath ignore the fog (the far flake layer fades by distance instead).
- Light shafts come from depth only: transparent objects (mist sheets, glows) don't occlude.
- Bergs have open undersides (asset note) — all are sunk 0.3–0.6 m and none is reachable from below.
- Collision bench: `climb_crate` / `jump_boulder` failures seen during this pass also occur with `?noatmo` (other agents' work in progress).
