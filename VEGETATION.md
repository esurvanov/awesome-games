# VEGETATION & ROCKS (wave 2)

Module `modules/vegetation.js` (order −10) · assets `assets/pack/veg_set.js`, `assets/pack/rock_namaqualand_boulder_02.js`, `assets/pack/rock_rock_face_02.js`, `assets/veg/*` · builder `tools/pack-veg.mjs`.
A/B switch: `open-world.html?noveg` (the module does not register).

| Area | Before | Now |
|---|---|---|
| Trees | 3 models near, **cone impostors** far | **10 species**, 3 LODs, dithered cross-fade, wind, shake |
| Grass | 6 flat vertex-coloured triangles (WorldFill) | **photo tufts** ×4, placed where snow is thin |
| Shrubs | primitive twigs | dwarf **birch / willow / crowberry**, clusters, 2 LODs |
| Ground spots | — | lichen / moss decals |
| Rocks | 1 boulder scan + blobs, 25 % sunk from the centre | re-seated on the lowest ground, tilted, + 2 new scans, lichen, snow |
| Draw calls (8 views, *high*) | 450–720 | **≤ 400** (see §6) |

---

## 1. Trees — `FOREST`

```
near  (d < nearMul × Q.treeNear)       real models (nearMul 0.47 pass-2, 0.36–0.4 pass-1), BatchedMesh per material, shadows d < FOREST.shadowR
far   (beyond)                         night-relightable octahedral impostor (assets/veg/imp, 8×8 hemi-octahedral), one instanced quad per species
```
FIX-LOOK (2026-09-26): the 16-tri cross cards and the daylight-baked 8-view billboard are gone — **one** LOD beyond the models.
The impostor material is a `MeshStandardMaterial` whose albedo + world normal come from the atlas (ray–plane hit, 1 parallax
step, 4 frames blended), so the moon, hemisphere, aurora light, fog and tone mapping are the near trees' own; gain 1, only
`IMP.shade` 0.7 (crown self-shadow the atlas lacks, measured with `tools/qa/lod-probe.mjs`: impostor/model tree luminance
0.70 → ≈ 1.0 at 90 m). Screen-door cross-fade over 14 m, complementary to the models' dither. Branch snow (`vegSnow`, world-up
normal + 3D noise clumps, `uVSnowK`) runs on models **and** impostors. `tree_pine_scots` retired (dark flat crown, inside-out
trunk); its share went to snow-laden / dense spruce. Trees are seated by their fitted trunk base (lowest snow surface around the
trunk − 12 cm, `seatTrees`): 95 trees lowered, worst 2.07 m (wind-bent firs lean off their origin).

| # | Species | Source | Where |
|---|---|---|---|
| 0 | tree_spruce_tall_snow | pass 1 (game pack) | mix 13 % |
| 1 | tree_spruce_small_snow | pass 1 | mix 8 %, high ground |
| 2 | tree_dead_birch | pass 1 | 3 % |
| 3 | tree_spruce_snowladen | pass 2 | mix 27 % |
| 4 | tree_spruce_young_dusted | pass 2 | mix 20 %, high ground, ridges |
| 5 | tree_spruce_dense_tall | pass 2 | mix 15 % |
| 6 | tree_fir_windbent | pass 2 | ridges (convexity > 1.4 m), +X downwind ± 20° |
| 7 | tree_spruce_krummholz | pass 2 | above 46 m, treeline band 38–80 m in groups, downwind |
| 8 | tree_pine_scots | pass 2 | 8 % |
| 9 | tree_snag_dead | pass 2 | rift outskirts (riftD 96–150) |

- Positions: the pass-1 list (`DECOR.trees`) + ≈ 230 extra (krummholz, wind-bent, snags). `FOREST.list === VEG.trees`, each entry `[x, y, z, s, r]` + `v` (species), `s` (scale), `yaw`, `y` (base), `mReal` (Matrix4, drawn **and** collider).
- Game forest retired without editing it: `FOREST.dirty/lx/lz` are getters → `updateForest()` returns early; `FOREST.R / shadowR` setters (setQuality) re-dirty our forest; `FOREST.far` (cones) hidden; the game's tree InstancedMeshes are removed once loaded and their geometry/materials adopted.
- `FOREST.parts[v]` = the BatchedMeshes holding species `v` (stand's trunk test raycasts `FOREST.parts[0]` bark).
- Colliders: species 0–2 by the game (unchanged path), 3–9 by us — `Passport.registerInstances(bark, mReal[], 'trunk', { part: /bark/i })`. All 793 trees have a trunk entry.
- Impostor atlas: one 2048×2560 sRGB render target, species block 1024×512 (4×2 cells of 256 px, ASSETS2 layout). Pass-2 billboards are blitted in (RGBA copied, colour bleed kept); pass-1 species are **baked at load** (orthographic, 8 azimuths, ambient ≈ albedo).
- Night tint: mid/far are lit by the scene lights (MeshStandard, crown normals) — the moon, hemisphere and aurora light them like the near trees; a gain (`mid 0.86`, `far 0.8`, `F.mid.material.userData.gain`) removes the baked daylight. Measured tree-pixel luminance near / mid / far: 62.7 / 63.2 / 75.9 → gain lowered.
- No pop: near↔mid and mid↔far switch with a screen-door dither over 14 m / 30 m bands (complementary patterns); tree shadows fade over the last 10 m before `shadowR`.
- Wind (vertex shader, every LOD): sway ∝ (height/12 m)², gusts travel along the wind, needle flutter; amplitude ×(0.18 + 0.82·`WX.storm`).

### `ctx.shakeTree(x, z, strength = 1, dx?, dz?)` → `true | false`
Nearest tree within 3.2 m: branch wobble (damped, pushed along `dx,dz`; 6 slots) + snow puff (particles via `ctx.emit`, amount by species: snow-laden spruce most, snag almost none). `false` = no tree or it is still settling (0.9 s). The interaction module calls it when the pilot brushes a tree; our own bump detector runs only when no interaction module is present.

## 2. Ground: tufts, shrubs, decals

Camera-centred 16 m chunks, generated deterministically (seeded per chunk), cached; nearest first, 3 chunks/frame (a teleport fills synchronously).

| Kind | Mesh | Draws | Radius (*high*) | Placement |
|---|---|---|---|---|
FIX-LOOK: tufts/shrubs take their albedo from `STYLE.palette` straw/heather colours (photo texture = relative detail), size by exposure, normals bent to up (lit like the snow), backlit transmission glow toward the moon, snow-coloured base 2–12 cm, sunk 7 cm; decals at 55 % opacity.

| tufts | 4 InstancedMeshes (one per variant) (dry tussock 50 %, sedge 25 %, seed grass 15 %, frosted 10 %), cards in one 2×2 atlas RT | 4 | `Q.vegGrassR` 60 m | thin snow, slopes, wind-scoured ridges, lake shore (sedge), rock feet; ≈ 2.5 % on deep snow |
| shrubs | InstancedMeshes: leaves full / LOD + twigs, per species | ≤ 9 (empty pools skip) | `Q.vegShrubR` 72 m | clusters of 3–8: birch + crowberry on bare ground, willow near water |
| shrub LOD | ⅓ of the leaf cards grown ×1.6 beyond 20 m, twigs hidden | 0 | | |
| decals | one InstancedMesh quad, atlas cell per instance (pale lichen / olive moss / orange lichen at rock feet), conformed to the ground normal | 1 | 0.8 × grass R | snow depth < 7 cm |

- Snow: with the terrain module, `ctx.snowDepthAt()` drives placement and height (tufts sit 10 cm into loose snow); fallback = the old normal-based snow mask.
- Bending: up to 8 actors (player, fox, stags, shardlings) push blades away and down (vertex shader).
- Distance fade: dither out over the last 10–14 m; alpha-to-coverage + mip-alpha boost against thinning.
- **WorldFill**: meshes `wf_clutter_grass` and `wf_clutter_shrub` are hidden (`visible = false`), and `WorldFill.passablesNear` is removed from `Passport.providers` (WorldFill still fills those pools — its stones/shards/wood pools are untouched).
- **Passport provider**: `Passport.passablesNear(x, z, r)` now returns our tufts/shrubs `{ x, z, r, h, kind: 'grass'|'shrub', src: 'veg' }` (also `ctx.vegPassablesNear`).

## 3. Rocks

| Set | Count | Model | Seating | Collider |
|---|---|---|---|---|
FIX-LOOK: every set is seated by the QA burial invariant itself (`seatDy`: mean share of the 3×3 footprint columns under ground + loose snow = 12–20 %, bisection), re-seated when the terrain re-stamps its drifts; snow pillow 20–24 cm displaced on up-facing tops (`cap`); outcrops use the closed-back scan `rock_rock_face_02_closed` (pack from assets/incoming3).

| boulders | 70 (same x/z/scale as before) | rock_boulder_01 | bottom = min(ground − 20–35 % height, lowest ground under 60 % of the footprint − 6 %) ; tilt ±0.15 rad, non-uniform scale | re-registered `solid` trimesh (`DECOR.boulderEntries`) |
| procedural | 300 | game blob | lowered onto the lowest ground under them | re-registered `solid` hull (`rock#k`) |
| flat boulders | 70 (40 next to big boulders) | rock_namaqualand_boulder_02 | as boulders | `solid` trimesh `rock_flat#k` |
| outcrops | 34 on 30–60° slopes | rock_rock_face_02 | open back pushed into the slope, face downhill, 25 % buried | `solid` trimesh `rock_outcrop#k` |

- "Ground" = heightfield + loose snow (`snowDepthAt`, capped 0.35 m).
- Shader (`rockMaterialPatch`): desaturate + cool grade toward the basalt terrain, orange lichen on the flanks (world-projected decal texture, noise-masked). Snow: `ctx.snowCover` from the terrain module (top snow + skirt; its obstacle stamps make the drifts); without it our own top snow + a merged snow-skirt mesh.
- `DECOR.rocksFlat`, `DECOR.rocksOutcrop` = instance matrices.

## 4. Draw-call director (scene-wide, 4 Hz, reversible)

| Rule | Effect |
|---|---|
| shadow LOD: a caster casts only within 30 m + 18 × its bounding radius | crate ≈ 38 m, stag ≈ 57 m, hut ≈ 120 m — each caster costs 2 draws (2 cascades) |
| skinned meshes with `frustumCulled = false` get a padded pose sphere (×1.5 + 0.8 m) and are culled again | stags / hermit / fox off-screen: 0 draws |
| tiny & far: < ≈5 px on screen (emissive < ≈2 px) → layer 0 off | main pass only |
| tree / ground batches with nothing visible or nothing casting skip the draw | |

Not touched: the player's subtree, BatchedMeshes, anything named `veg_*`, and objects with `userData.vegKeep = true`. When an owner changes `castShadow` / `layers` itself, that becomes the new baseline. Stats: `VEG.stats.director`.

## 5. Knobs (added to `QUALITY` presets)

| Knob | low | med | high | ultra |
|---|---|---|---|---|
| `vegTreeMid` (m, mid → billboard) | 210 | 260 | 300 | 380 |
| `vegGrassR` (m) | 36 | 50 | 60 | 80 |
| `vegShrubR` (m) | 45 | 60 | 72 | 100 |
| `vegDecalR` (m, informational) | 28 | 40 | 52 | 70 |
| existing `treeNear` / `treeShadow` / `grass` | near radius / shadow radius / ground density | | | |

## 6. Measurements (M1 Pro, 1400×800, *high*)

Draw calls (renderer calls/frame incl. 2 shadow cascades) and vsync fps, `stand/veg-before` → `stand/veg-after` (compare: `stand/compare.html`):

| View | draw calls | fps (vsync) |
|---|---|---|
| crash_close | 625 → 400 | 59.9 → 59.9 |
| crash_wide | 495 → 332 | 59.9 → 59.9 |
| station | 575 → 405 | 59.9 → 59.9 |
| forest | 549 → 353 | 59.9 → **30** (see below) |
| boulders | 522 → 256 | 59.9 → 59.9 |
| rift_rim | 519 → 262 | 59.9 → 59.9 |
| sea_horizon | 288 → 169 | 59.9 → 59.9 |
| player_rock | 445 → 238 | 59.9 → 59.9 |

Same-moment A/B (`?noveg`, other agents' content included): 643/555/586/574/512/508/352/468 calls without this module vs 400/332/405/353/256/262/169/238 with it.
Collisions 8/8, 0 JS errors, 12/12 loader modules, 0 black frames (8 views + 4 `--station-spots`).

**Open:** fps is not settled. Uncapped (`--unlimited`) runs show the module costs 3–8 ms/frame (mostly the near needle batch + its shadow); on this machine the forest / player_rock views sometimes drop to the 30 fps vsync step. The last runs (22:30) gave 30 fps on every view *with and without* the module, so the machine was throttled and the final numbers could not be re-measured. Knobs to trade quality for speed: `NEW_MUL` / `nearMul` (real-model radius, now 0.47 / 0.36 × treeNear), `treeShadow`, `vegShrubR`.


## 7. Notes / known issues

- 24 NaN vertex colours in the pass-2 needle meshes (and any zero normals) are repaired at load (`VEG.stats.nanFixed`); every patched fragment shader ends with a NaN/Inf guard — a single NaN pixel + bloom = black frame. `tools/stand.mjs` now checks every view for a black frame (`summary.blackFrames`) and has `--station-spots`.
- Texture units: our heaviest program (rocks with terrain snow) uses 12 of 16; the terrain module's `TR_DETAIL` program uses 16/16 — the likely source of "too many textures" warnings if anything adds a sampler there.
- Shadow LOD makes small shadows appear at 35–60 m when walking up (no per-object fade possible).
- Billboards are baked in daylight; far trees follow moon/aurora colour through lighting, not through their own normals.
- `tools/pack-veg.mjs` rebuilds the pack + textures from `assets/incoming2` / `assets/incoming`.
- Credits: EZ-Tree © Daniel Greenheck (MIT) — tree/shrub textures; ambientCG (CC0) — tufts, lichen, moss; Poly Haven (CC0) — rock scans, bark.

Note: ground clutter uses InstancedMesh, not BatchedMesh: on ANGLE/Metal the BatchedMesh multi-draw is emulated per instance and cost ~5 ms at 2 k tufts. The trees still use BatchedMesh (≤ 150 visible instances per batch).
