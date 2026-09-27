# ASSET-QUALITY-1 — near-tree crown depth + hab-module surface

Two user-flagged "asset itself, not a shader fix" complaints, re-examined for headroom. Both got a real,
shipped, code-only improvement; both still have a real, honestly-unclosed asset limit behind them.
Owns `modules/vegetation.js` + `modules/structures.js` only (order 30/−10). No new texture sampler was added
to either material — the known 16-unit terrain/GroundBlend budget problem (see below) does not apply here.

## 1. Trees — crown depth without a new attribute or sampler

`modules/vegetation.js`, `patchTreeNear()` (near-LOD needle/leaf material only, not bark, not impostors).

**What was already there, unused:** the needle geometry ships a per-vertex `color` attribute (itemSize 4) that
three's `vertexColors: true` already multiplies into the albedo. Probed the live `veg_tree_needles` BatchedMesh
(`tools/qa/probe.mjs`): R≈G≈B for every vertex sampled (it's a baked greyscale shading value, not a hue tint),
mean 0.73, sd 0.19, and it correlates (r ≈ 0.44) with distance from the local trunk axis — i.e. it **is** baked
per-vertex crown shading/AO from the source authoring, just applied as a weak *linear* multiply that the scene's
hemisphere/moon fill light washes out almost flat. Alpha channel is always 1 (unused, confirmed, not touched).

**Fix:** re-read that same raw value in the fragment shader and reshape it with an S-curve + floor
(`GLSL_CROWN_AO`, wired into `#include <color_fragment>` right after three's own multiply, needles/leaves
materials only): `vAoK = mix(0.4, 1.0, smoothstep(0.42, 0.95, vAo))`. Zero new attributes, zero new samplers,
one extra `smoothstep` + multiply per pixel on an already-bound varying.

**Rejected first:** widening the atlas resolution — checked `assets/veg/foliage_atlas.png` (1024², paletted);
upsampling it adds no real information, and authoring new content is out of an agent's scope this wave (matches
INT-VEG.md's prior conclusion: card density/silhouette needs new EZ-Tree source geometry, not code).

**Verified:**
- 0 shader errors (`H.errors` empty on every probe run); needles/leaves BatchedMeshes render.
- No new texture-unit warning: confirmed a "Trying to use N texture units" warning stream already exists at
  clean committed HEAD (reproduced in an isolated worktree copy with `terrain.js`/`interaction.js`/`vegetation.js`
  all reset to `git show HEAD:...`, still fires) — pre-existing, not mine, not something this wave's ownership
  (`vegetation.js`/`structures.js`) can fix. Flagging for the main agent: even the last commit already overflows
  somewhere (terrain/GroundBlend's own documented 16/16 edge case), independent of this work.
- Look-gate (`stand/lookgate-assetfix1/`, `review.json`): `tree_close` **lighting** 2→3 vs the accepted run
  (`perf1`) — "same near-black crown mass" is gone, replaced by real darker-interior/brighter-outer variation —
  confirmed with an isolated same-camera before/after (clean worktree copy, `stand/lookgate-habbefore` pattern)
  so it isn't confounded by other agents' concurrent terrain/interaction WIP. **Not fixed**: silhouette/surface
  (still 2/1, unchanged) — the jagged flat-card silhouette itself is a geometry problem, this only touched
  shading. `forest_mid` scored conservatively as **same** (the nearest tree there is inside near-LOD and does
  show the same effect on close inspection, but at that framing's scale/distance it isn't a confident win, and
  the run's foreground snow-ripple pattern changed for unrelated reasons — another agent's uncommitted
  `terrain.js` — so I didn't want to claim credit for something I can't attribute).
- fps: draw calls / triangle counts unchanged (confirms zero added draw calls/geometry: forest view 296→296
  calls, 2.471M→2.474M tris in an isolated before/after). vsync-capped fps unchanged at 59.9 on both `high` and
  `low` in the isolated copy. Uncapped numbers were too noisy to quote cleanly (shared machine load rose from
  ~11 to ~34 over the session as other agents' waves ramped up) — reported qualitatively: the added shader work
  is a `smoothstep`+multiply on an already-live varying with zero new samplers/draws, i.e. immeasurably cheap
  next to a 300-draw-call / 2.5M-triangle scene.

## 2. NASA hab module — procedural surface variation (not a texture upgrade)

`modules/structures.js`, `fixHabMat()`. GroundBlend already fixed metalness/roughness (no longer a dark blob)
and already added diffuse blotch/streak noise; the complaint ("модель голимо отрисована") is the underlying
1024² colour map itself being soft at ~1–2 cm/texel across 12 m of hull — diffuse noise breaks up *tone*, not
the missing edge/seam *frequency* that would read as "built hardware" instead of a soft photo.

**Checked first:** no spare higher-res station/hab asset anywhere in `assets/incoming*` (only the one
`struct_hab_module.glb`, and the already-adopted `struct_station_dome`/`struct_station_module` from
`incoming2`, which are separate models, not a hab replacement). Texture filtering was already optimal
(anisotropy 8, `LinearMipmapLinearFilter` — confirmed live via probe) — the softness is genuinely the
1024² source, exactly as GROUNDBLEND.md already concluded.

**What was tried and rejected:** a full Mikkelsen tangent-free derivative bump (screen-space world-position
derivatives, no UV/tangent basis needed — the textbook technique for bump-mapping an unparametrized surface)
at a real strength. **This looked much worse, not better**, and was caught before it ever reached the shared
look-gate queue: on this near-cylindrical hull, some screen directions send the surface-derivative determinant
toward 0, and dividing the height-gradient through it blows the perturbation up into a harsh camo/dazzle
zebra pattern that hides the NASA logo and flag decals entirely (side-by-side crop in
`/tmp/.../hab_dome_compare.png`, reproduced in an isolated worktree copy holding the camera/world fixed so it
wasn't a framing artifact). Rejected outright — did not ship, did not run through the shared benchmark lock.

**What shipped instead:** a numerically stable replacement — perturb `normal.xy` by a **clamped** screen-space
gradient of the same coarse noise field (`habBH = habN(vHabW*2.2)*.6 + habN(vHabW*8.0)*.4`, `habG =
clamp(vec2(dFdx,dFdy)*1.6, ±0.3)`), no division anywhere, so no blow-up at any viewing angle. Verified by a
second isolated same-world A/B: legible decals preserved, a real but modest patchy wear/grime variation now
visible on the lit hull under raking moonlight (crop comparison), no artifacts at the silhouette edges, dome
top, or the dark crate parts (where the rejected version was worst).

**Verified:**
- 0 shader errors; both hab meshes report `userData.habFix === true` after load.
- No new texture-unit warning (same pre-existing-at-HEAD caveat as above — this change adds no sampler either).
- Look-gate (`contact_close`/`hab_close`): no accepted baseline exists for this subject (added after `perf1`
  was captured), scored on absolute rubric — surface 2/5 ("still visibly a soft/low-res photo up close... does
  NOT raise the underlying map resolution"), lighting 3/5 (now shows tonal variation instead of one flat
  gradient), no new anti-pattern (`plastic` noted as still partly true — the effect is deliberately subtle
  after the strong version had to be walked back).
- fps: identical draw-call/triangle reasoning as above — one extra small noise+gradient block on 2 meshes,
  zero new samplers/draws.

**Not fixed — asset limit, not a code limit:** the colour map's actual resolution/authoring is unchanged. A
real fix needs either (a) a higher-resolution repaint of the same 1024² atlas without the baked-in NASA
logo/flag/shading (would need ~2048–4096², redone by an artist or a texture-gen tool), or (b) a different
source model entirely (a CC0 modular habitat, e.g. from Poly Haven or a similar library) — proposal only, not
fetched, per this task's constraints; flagging for the user/main agent to pick a source before any agent
downloads or authors new art.

## Files

- `modules/vegetation.js` — `GLSL_CROWN_AO` + `patchTreeNear()` hook (needles/leaves only).
- `modules/structures.js` — `fixHabMat()`, `normal_fragment_maps` hook.
- `stand/lookgate-assetfix1/` — `tree_close`, `forest_mid`, `contact_close` (rock/tuft/heather/hab), `review.json`
  (honest, not run through `check`/`accept` per instructions).
- Isolated-copy scratch renders used for clean A/B (not part of the repo, scratchpad only):
  `stand/lookgate-habbefore`, `stand/lookgate-habafter` (rejected v1), `stand/lookgate-habafter2/3` (accepted),
  `stand/iso-before-unl`, `stand/iso-after-unl2`.

## Open (honest, not closed this wave)

- Tree silhouette/surface (paper-cutout cards, needle density near the trunk): needs new source geometry
  (EZ-Tree authoring or a different tree asset), not reachable from a shader/placement change — same
  conclusion INT-VEG.md already reached, unchanged by this wave.
- Hab module colour-map resolution: needs a repaint or a replacement asset — proposal above, not executed.
- The pre-existing "texture units" console warning at clean HEAD (not introduced by, and not fixable from,
  this wave's two owned files) — flagged for the terrain/GroundBlend owners.
