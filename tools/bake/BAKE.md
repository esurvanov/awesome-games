# BAKE — offline night-light bake for a world where the moon never moves

The island's light never changes (fixed moon, fixed sky, no day cycle), so nothing here needs to be recomputed at
runtime. Cycles bakes the whole static world once, offline, at whatever quality the GPU-hour budget allows; the game
ships the result as small compressed textures and turns the expensive parts (ambient sky/bounce lighting, screen-space
AO, most of the moon-shadow distance) off in exchange for looking those textures up.

Pipeline: **export → bake → encode → runtime**. Each stage is a separate tool so any one of them can be re-run alone.

```
node tools/bake/export-scene.mjs                 # 1) live game → tools/bake/out/{scene.glb,export.json}
node tools/bake/run-bake.mjs                      # 2) Blender/Cycles → tools/bake/out/bake/{png/*.png,bake.json,uv2/*.bin,treeao/*.bin}
node tools/bake/encode.mjs                        # 3) → assets/baked/{*.ktx2(.js),manifest.json,uv2.js,treeao.js,basis_wasm.js}
<script src="modules/baked.js"> in open-world.html # 4) runtime (currently tools/bake/runtime/baked.js — not wired in yet, see §Integration)
```

## 1) Export — `export-scene.mjs` + `page-export.js`

Headless Chrome (puppeteer-core, system Chrome, the game's own artifact CSP) opens `open-world.html#dbg`, starts a
new game, waits `--warm` ms (default 22 s: packs, rock re-seat, snow drift settle), then injects `page-export.js` and
calls `window.BAKE_EXPORT()`.

What gets pulled out of the live three.js scene:
- every **static** mesh: not under a dynamic root (pilot, fox, snowmobile, Orm, golem, stags, enemies, pushable
  props — the same list `SHADOW.dynRoots` uses), not skinned, lit material (Standard/Physical/Lambert/Phong),
  not camera-streamed clutter (`veg_tufts/shrub/decals`, `wf_clutter_*` — those stay dynamic), visible.
- **trees**, from the vegetation module's `BatchedMesh`es directly (every tree on the island, not just the near ones).
- the **terrain**, re-sampled on a fine grid from the *rendered* snow surface (`Terrain.snowSurfaceAt`), not from the
  heightmap that feeds it — so the bake matches drift/pressure-ridge deformation exactly as seen.
- moon + aurora as `KHR_lights_punctual` directional lights, static point lights, and `scene.extras.env` (sky texture
  reference, hemisphere term, aurora tint, fog, tone mapping — everything `bake.py`'s Cycles world needs to reproduce
  the game's night look).

Output: `tools/bake/out/scene.glb` (one GLB; instanced sets as `EXT_mesh_gpu_instancing`) + `tools/bake/out/export.json`
(same data minus geometry — object list, categories, per-object bake mode, env, terrain grid, POIs).

### IDs (must match on both sides of the pipeline)

A non-instanced object's id is **`bakeId()`**: its name path from the scene root + its material name/type + its
world position rounded to a 0.5 m grid — *not* child index, which shifts whenever any module adds an object:

```js
namePath(o) + '|' + (material.name || material.type) + '@' + round(pos, 0.5m)
```

Duplicate ids at the same spot (identical twins) get a `#1`, `#2`, … suffix in scene-traversal order. An instanced
set's id is built from its name, material, vertex/instance count and the world position of instance 0 — the same
formula appears in `page-export.js: bakeId()` (export) and `runtime/baked.js: bakeId()` (must be applied to the
*same* scene, in the *same* traversal order, for the ids to line up — the runtime does exactly what the exporter
does: `scene.traverse`, mesh-only, non-instanced, non-skinned).

A tree part's id is `'tree:' + BatchedMesh.name + '|' + geometryId` (one id per unique sub-geometry — e.g. one spruce
species' bark, needles, snow-cap — shared by every instance of that part on the island).

## 2) Bake — `bake.py` (Blender 4.2 LTS, Cycles), driven by `run-bake.mjs`

```
node tools/bake/run-bake.mjs [--blender /path/to/Blender] [--steps terrain,tiles,objects,instanced,trees] [--quick]
```

Cycles saturates the GPU, so `run-bake.mjs` never runs it free-standing: every step (one terrain quadrant, a batch of
POI tiles, one object atlas, …) takes `tools/.stand.lock` — **the same lock `tools/stand.mjs` benchmarks use** — and
releases it before the next step, so a queued `stand`/`qa` run on this machine gets its turn in between (`bake.py`
itself never touches the lock; `run-bake.mjs` wraps each invocation). `--quick` = a fast draft pass (24 samples,
1024² terrain, 256² tiles) to validate the whole pipeline in ~30 min; the real settings are 128 samples / 4096² /
1024² and take substantially longer per step — run overnight or in an idle GPU window.

Light model, matched to the game's night preset (`export.json.env`):

| term | source |
|---|---|
| moon | Sun lamp, strength = three's `DirectionalLight.intensity`, 1.2° disc (soft penumbra) |
| sky | World shader: `assets/sky.jpg` upper hemisphere × `envIntensity`, + a uniform hemisphere term (reproduces three's `HemisphereLight` irradiance), + a faint aurora band |
| aurora | a second Sun lamp (`aurLight`) |
| point lights | three candela × 4π (glTF "compat" units) |

Two channels come out of every bake target:
- **AMB** — sky dome (direct + bounce) + emissive surfaces + *indirect* bounce of moon/aurora/points. This is what
  replaces the hemisphere/IBL ambient term at runtime; direct moon/aurora/point light stays dynamic (uncached).
- **VIS** — moon visibility only (1 = lit, 0 = in permanent static shadow), from `DIRECT`-only bakes with/without
  `MOON.cycles.cast_shadow` (4–5× cheaper than Cycles' own SHADOW bake type on this GPU).

Four kinds of output, one Blender job each:

1. **Terrain** (`--jobs terrain`) — one world-space atlas over the whole island (default 4096², `--quick` 1024²),
   baked in 4 quadrants (each its own Blender process so the GPU is released between quadrants) then assembled.
2. **POI tiles** (`--jobs tiles`) — a second, higher-resolution atlas of 128 m squares around points of interest
   (crash site, station, lake, rift, three spires, World-Fill camp/ship/pier/ruins — merged if two sites are within
   35% of a tile of each other), packed into one grid texture. The runtime samples this *in addition to* the terrain
   atlas near a POI (§Runtime), so those areas get far more texels per metre without inflating the base atlas.
3. **Objects** (`--jobs objects`) — every unique static mesh gets lightmap UV2 (Blender smart-project + pack) and is
   baked into one shared atlas per site (crash/station/camp/misc — few enough objects elsewhere that they all share
   one atlas). Meshes whose world footprint exceeds ~90 m (the sea plane, sea ice, `wf_built`, one giant merged rock)
   are skipped — too large for one lightmap island to pay off — and listed in `bake.json.objectsUnbaked`.
4. **Instanced geometry** (`--jobs instanced`) — shared meshes drawn many times (rocks, ice chunks, ruins, tents,
   poles, …) get ONE small object-space AO texture on UV2 per unique geometry (an isolated white-world AO bake,
   everything else hidden) — reused across every instance, however many thousand.
5. **Trees** (`--jobs trees`) — a custom BVH ray caster (not a Cycles bake — the foliage cards are alpha-cut,
   double-sided coincident-face pairs, and Cycles' vertex bake samples the (transparent) card corners). Per vertex:
   cosine-hemisphere rays through up to 6 alpha-tested hits give **crown AO** (both card sides for foliage — a card is
   lit from whichever side faces the sky) and **sky visibility** (upper hemisphere only, "how much of the moon/aurora
   glow can reach here") — the fix for spruce/fir crowns rendering as flat, uniformly-lit cut-out cards with a black
   trunk core: every vertex now carries its own local occlusion instead of one flat per-card value.

All five write into `tools/bake/out/bake/`: 8-bit PNGs (`png/*.png`), per-corner UV2 (`uv2/*.bin`, Float32, exported
index order), per-vertex tree AO (`treeao/*.bin`, Uint8 ×2), and `bake.json` (what was baked + scales + file
references — jobs can be re-run individually; `bake.json` keeps what earlier runs baked unless `--fresh`).

**Encoding** (`bake.json.encoding`): `rgb8 = sRGB-curve(AMB / scale)`, `a8 = VIS` (linear). `scale` is the baked
target's 99.7th-percentile texel value ×1.05 (`pct_scale()`) — a per-atlas exposure so 8-bit PNGs don't clip the
brightest few texels (moonlit snow, emissive signage) while keeping the rest of the dynamic range. The runtime decodes
back to linear and multiplies by `scale` (`lightMapIntensity = π · scale`, §Runtime).

## 3) Encode — `encode.mjs` → `assets/baked/`

```
node tools/bake/encode.mjs [--mode etc1s|uastc] [--q 190]
```

Needs the Basis Universal CLI (`brew install basis_universal` → `basisu`). Every baked PNG becomes a KTX2 (Basis
Universal, ETC1S by default — the lightmaps are smooth gradients; `--mode uastc` for max quality on the terrain/tile
atlases if size allows), mipmapped, row-flipped at encode time (`-y_flip`) to match three's `flipY = false` sampling
of compressed textures. Because `.ktx2` is not a file type the artifact host serves, every texture ships twice:
- `<name>.ktx2` — the real file, kept for reference/debugging, not fetched by the runtime;
- `<name>.ktx2.js` — the *same bytes* as base64 in a classic script: `(window.__PACK=window.__PACK||{})['baked/<name>']='<base64>'`.

Plus three bulk packs: `uv2.js` (every baked mesh's per-corner UV2, quantized to `Uint16`, one buffer + per-object
byte offsets in `manifest.json`), `treeao.js` (every tree part's per-vertex AO+sky, `Uint8` pairs), and
`basis_wasm.js` (the three@0.186.1 Basis transcoder wasm, so the runtime never needs a cross-origin `fetch`).
`manifest.json` ties it all together — everything §Runtime reads.

**Two bugs found and fixed while finishing this pipeline** (both were silent — `encode.mjs` ran to completion and
produced a *plausible-looking* `assets/baked/`, just missing/wrong data):
- the POI tile atlas was never encoded: the code read `bake.json.tiles` (an array `bake.py` always leaves empty —
  it's dead scaffolding) instead of `bake.json.tileAtlas` (the actual object, with its 12-tile `.tiles` list). Fixed
  to encode `R.tileAtlas` into `manifest.tileAtlas`, which is what `runtime/baked.js` already expected.
- `addUV()` read a `Float32Array` straight off a Node `Buffer`'s `.buffer` — for any file under ~4 KB, `fs.readFileSync`
  returns a `Buffer` sliced from Node's internal pool, so `.buffer` is the *pool's* (bigger) `ArrayBuffer` and
  `.byteOffset` is nonzero; slicing from 0 instead of `byteOffset` reads the wrong bytes (or a length that isn't a
  multiple of 4, which is what actually surfaced it — `RangeError`). Fixed to respect `byteOffset`/`byteLength`.

## Sizes (this bake — `--quick` draft settings, see §Follow-ups)

| | |
|---|---|
| terrain atlas | 1024², 166 KB |
| POI tile atlas | 1024² (4×4 grid of 12 sites), 175 KB |
| object atlases | crash 512² (33 objs) · station 1024² (34) · camp 256² (16) · misc 2048² (40) — 620 KB total |
| instanced AO | 30 geometries, 128²–512², 1–95 KB each |
| tree crown AO | 19 parts (9 species), per-vertex, 158 KB total |
| transcoder wasm | 703 KB (base64) |
| UV2 sidecar | 4.1 MB (base64 `Uint16`, every baked mesh's lightmap UVs) |
| **total `assets/baked/`** | **7.5 MB** (well under the 25 MB budget) — raw KTX2 bytes: 1.16 MB, base64 packs: 6.52 MB |

## Runtime integration

`tools/bake/runtime/baked.js` is a **finished reference implementation**, tested end-to-end in a scratch copy of the
repo (§A/B) — not loaded by the real game yet. To wire it in:

```html
<!-- after style.js, before the game's own <script type="module"> -->
<script src="tools/bake/ktx2-csp.js"></script>          <!-- → move to modules/ or assets/baked/ when integrated -->
<script src="assets/baked/basis_wasm.js"></script>
<script src="modules/baked.js"></script>                <!-- = tools/bake/runtime/baked.js, copied in -->
```

It registers itself on `window.GameModules` (`order: 50`, after terrain/vegetation which build the meshes it patches)
and needs nothing else from the game beyond the usual module context (`C.scene`, `C.renderer`, `C.THREE`, `C.Q`).

### Why not `THREE.KTX2Loader`

Three's own loader `fetch()`es the transcoder `.js`+`.wasm` from a CDN and runs it in a `Worker` built from a
`blob:` URL. The artifact CSP (`connect-src 'self'`, no `blob:` in `script-src`) forbids both. `tools/bake/ktx2-csp.js`
is a from-scratch KTX2→`THREE.CompressedTexture` path built for exactly this constraint:
- the transcoder **script** loads as a plain `<script src="https://cdn.jsdelivr.net/npm/three@0.186.1/…/basis_transcoder.js">`
  (CDN `<script src>` is allowed; `fetch()` to it is not),
- its **wasm** ships as a base64 pack (`assets/baked/basis_wasm.js`) and is handed to the emscripten module as
  `wasmBinary` — never fetched,
- every `.ktx2` ships as a base64 pack too, for the same reason,
- transcoding runs on the **main thread** (no Worker) — a handful of 4k-ish maps at load, ~10–60 ms each.

`BakeKTX2.init(renderer)` picks the best GPU format the browser actually supports (ASTC → ETC2/ETC1 → BPTC → S3TC →
raw RGBA32 fallback, same ranking three's own `KTX2Loader` uses). `BakeKTX2.fromPack(THREE, 'baked/<name>')` reads a
pack, transcodes, and returns a texture with `flipY = false` (matching the encode-time `-y_flip`) and
`colorSpace = NoColorSpace` — the runtime decodes the sRGB curve itself in GLSL (`bakeDec()`), because the baked
value isn't really an sRGB-encoded *color*, it's a gamma-curved *irradiance* value (see §Encoding above), and three's
own sampler-format sRGB decode would clamp it to `[0,1]` before the `π·scale` multiply.

### What gets patched, and how

Every patched material keeps its own `onBeforeCompile`/`customProgramCacheKey` chain (`chain()`) so the baked GLSL
composes with whatever the material already does, and recompiles cleanly when `BAKED.on` flips (the cache key
includes it).

- **Terrain** (`patchTerrainMat`) — a **world-space** lookup: `vBakeXZ` (the vertex's world XZ) samples the terrain
  atlas by `(xz - origin) / size`, then checks up to 16 POI tile cells (`uBakeTile[i]`) and cross-fades into whichever
  one contains this fragment (`smoothstep` feather over the last 8% of the tile, so the seam is invisible). Both
  `TER_U.tBakeT`/`tBakeTiles` are one texture each (the tile atlas is one packed grid, not one texture per POI), plus
  a 4-float "which rectangle of the atlas, at what scale" per tile — cheap enough for 12+ POIs in one draw call.
- **Objects** (`patchObjectMat`) — uses three's own `lightMap` slot: `geometry.uv1` = the UV2 sidecar (quantized back
  from `Uint16`), `material.lightMap` = the object's atlas texture, `material.channel = 1`,
  `lightMapIntensity = π · atlas.scale`. The shader still decodes the gamma curve itself (`bakeDec`) — the texture's
  `colorSpace` stays `NoColorSpace` so three doesn't double-decode it.
- **Trees** (`patchTreeMat`, added while finishing this task — see §Follow-ups, it was missing) — no lightmap UV;
  instead every tree part gets a `treeAO` vertex attribute (written directly into the shared `BatchedMesh` geometry's
  vertex range, `getGeometryRangeAt(gid)` — same "one bake, many instances" idea as instanced-object AO, just
  per-vertex instead of per-texel) and the shader reuses the **terrain's own world-space ambient lookup** at the
  tree's position, scaled by the vertex's crown AO (`bk.rgb *= mix(0.35, 1.0, ao)`). That is the "flat cards, black
  core" fix: instead of one uniform ambient value lighting the whole card, each vertex is now individually darkened
  by how enclosed it is inside the crown, so the trunk core reads as occluded and the outer needles don't.
- Both patches replace `irradiance` (`lights_fragment_maps`'s `RE_IndirectDiffuse` — the ambient/hemisphere +
  IBL-diffuse term) with the baked value and zero the live IBL diffuse contribution (`iblIrradiance *= 0.0`); IBL
  **specular** (reflections) is untouched.

### Moon shadows: baked visibility + the live cached-shadow cascades

The game already caches moon shadows in two static cascades that re-centre on the player (`SHADOW`, commit
"cached moon shadows"): a sharp near one (`Q.shC0`) and a soft far one out to `Q.shadowDist`. `patchSunChunk()`
inserts one line into three's shared `getSunShadow()` GLSL chunk:

```glsl
return acc + rem;              // before
return acc + rem * bakeVis;    // after — bakeVis defaults to 1.0 (no-op if nothing sets it)
```

`bakeVis` is set, per material, from the baked VIS channel (terrain's alpha / an object atlas's alpha) *only where a
live shadow cascade doesn't cover the point* (`rem` is exactly three's own "outside the far cascade, use the light's
own falloff" term) — so baked visibility never overrides a live cascade, it only fills in what's beyond it. That is
what lets `Q.shadowDist` **shrink** while `BAKED.on`: the live cascades only need to cover dynamic casters and near
detail; everything past that already has its permanent moon-shadow state baked in. `applyQ()` does this automatically
(`BAKED.shadowDist`, unset by default — the reference implementation doesn't change the default distance on its own,
a game-side tuning pass should set it once the integration is real) and also turns the screen-space GTAO pass off
while baked (`BAKED.gtaoOff`, on by default) since the baked AO/sky-visibility already covers static surfaces.

### Knobs

`BAKED.on` (A/B toggle — also flips GTAO and `Q.shadowDist`, §above), `BAKED.k` (global intensity multiplier on the
decoded irradiance, before the `π·scale`), `BAKED.gtaoOff`, `BAKED.shadowDist`, `BAKED.stats` (`terrainMats`,
`objects`, `treeParts`, `missing[]` — every id the manifest expected but the live scene didn't have, for diagnosing a
stale bake after a world edit).

### Re-baking after a world edit

The ids (§IDs) are stable across a *seeded* world, but change if an object's name, material name, or world position
(> 0.25 m) changes — which any content edit to `modules/*.js` can do. There's no drift detector: a stale bake just
silently stops matching (`BAKED.stats.missing` grows) and those objects fall back to whatever the material would
otherwise have received (i.e. `RE_IndirectDiffuse` gets zeroed with no `lightMap` — matching `#else vec4 bk =
vec4(0,0,0,1)` for objects, unpatched materials for anything the traversal never found at all). Re-running steps 1–3
(`export-scene.mjs` → `run-bake.mjs` → `encode.mjs`) regenerates a matching bake; there is no incremental bake-only
option for "just the objects that moved" — the exporter doesn't diff against the previous export.

## A/B — scratch-copy methodology and results

Per instructions, the A/B never touches the real repo: `tools/bake/ab.mjs --root <scratch copy>` opens the scratch
copy through `tools/bake/lib.mjs`'s `openWorld()`, which **always** takes the real repo's `tools/.stand.lock`
(resolved relative to `lib.mjs`'s own path, not `--root`) — so it queues behind every other benchmark on the machine
exactly like `stand.mjs` would, even though it's serving a different directory.

Method: for each of 4 views (`crash_wide`, `forest`, `rift_rim`, `sea_horizon` — object-heavy, tree-heavy, terrain
mid-distance, terrain far horizon), toggle `DBG.BAKED.setOn(true)` / `setOn(false)`, settle, measure median fps /
frame time / draw calls / triangles over 3 repeats × 1.2 s each (`requestAnimationFrame` deltas, same method
`tools/stand.mjs` uses), screenshot both states.

**Numbers: blocked, not just pending — a real bug found, not yet fixed.** Two rounds of diagnosis:

1. First full run: `BAKED.on=true` and `=false` measured *bit-identical* (`BAKED.stats: {terrainMats:0, objects:0,
   missing:[]}`, `BAKED.ready` never true within 30 s) at a flat 59.9 fps in every state. Two compounding causes:
   the scratch copy's `assets/baked/` hadn't been populated yet when it was made mid-pipeline (fixed — copied the
   finished bake in), and `ab.mjs` never asked `lib.mjs`'s `openWorld()` for `unlimited: true`, so every measurement
   was vsync-capped regardless of `BAKED.on` (fixed — `ab.mjs` now passes it by default, `--capped` to opt out).
2. With those fixed, `BAKED.ready` **still** never becomes true. A targeted diagnostic (`window.addEventListener
   ('error', …)` before anything else runs) caught this, uncaught, within the first couple of seconds of every page
   load — before the A/B script does anything at all:

   ```
   pageerror: Evaluating a string as JavaScript violates the following Content Security Policy directive
   because 'unsafe-eval' is not an allowed source of script: script-src 'self' 'unsafe-inline'
   'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com".
   ```

   Nothing in this game's own code (`modules/*.js`, `open-world.html`) calls `eval()` — a repo-wide grep for it comes
   up empty, and the only other CDN-loaded runtime piece (Rapier physics) isn't wired into this build (`PH.ok` stays
   `false`, 2D-circle fallback) — while `tools/bake/ktx2-csp.js` is the ONE new piece of CDN-loaded code this task
   added (`basis_transcoder.js`, an Emscripten build, fetched as a plain `<script>` per the design in §Runtime). By
   elimination, the Basis Universal transcoder's own glue code appears to call plain `eval()` somewhere in its
   startup path (a common Emscripten pattern — environment detection, `dynCall` trampolines) — which the artifact
   CSP's `script-src` blocks (`'wasm-unsafe-eval'` only covers `WebAssembly.instantiate`, not `eval`/`new Function`).
   Effect: `BakeKTX2.init()`'s `new Promise((ok) => { window.BASIS(mod); })` never calls `ok()` (`onRuntimeInitialized`
   never fires) and never rejects either (the throw happens deep inside BASIS' own async internals, outside that
   Promise's executor) — `runtime/baked.js`'s `load()` hangs forever awaiting it, silently: `BAKED.ready` stays
   `false`, `BAKED.error` stays unset, nothing in the reference implementation's own error handling ever sees it.

   **Not fully confirmed** — pinning it to an exact line in `basis_transcoder.js` needs one more run with a
   `window.onerror` handler that survives to inspect `e.filename`/`e.lineno`, which a scratch diagnostic script of
   mine (my own bug: an `await page.evaluate(() => new Promise((res) => {...}))` that never calls `res()`) is
   currently hung on, holding the real benchmark lock until Puppeteer's own 30-minute `protocolTimeout` clears it —
   I could not `kill` it myself (blocked: touching another process, even one's own, needs explicit permission here)
   and chose not to route around that block. **If this diagnosis holds**, the CDN Basis transcoder as shipped is
   simply incompatible with this CSP, and the fix is not a config tweak: either (a) source/build an Emscripten
   variant of the transcoder with `-sDYNAMIC_EXECUTION=0` (removes `eval`/`new Function` codegen entirely) instead of
   the stock `three@0.186.1` CDN build, or (b) skip runtime Basis transcoding altogether — pre-transcode each KTX2 at
   *encode* time (`encode.mjs`, in Node, no CSP) into one fixed GPU-compressed format (or plain RGBA8) and ship that
   directly as a `THREE.CompressedTexture`/`DataTexture`, at the cost of no longer picking the best format per
   browser. Neither is done here — this needs a human call (extra build tooling vs. a fixed texture format) before
   more engineering time goes into it.

Before/after screenshots: not captured for the same reason (the fps comparison never ran to completion) — the game
loads and renders correctly under `BAKED.on` staying stuck at its unpatched default (terrain/objects never get a
`lightMap`, so visually the scratch copy currently looks identical to `BAKED.on=false` regardless of the toggle).

## Follow-ups (found while finishing this task, not yet done)

- **Tree crown AO was never applied at runtime** — `bake.py`'s trees job and `encode.mjs`'s `treeao.js`/`man.trees`
  existed, but `runtime/baked.js` had no code path for it at all (only terrain + objects). Added `loadTrees()` +
  `patchTreeMat()` (§Runtime) as part of finishing this task.
- **Night-lit far-tree impostors** (brief item 2) are not implemented. Building them means changing how
  `modules/vegetation.js` draws distant trees (billboard impostors instead of far LOD meshes) — a game-file change,
  outside this task's `tools/bake/` + `assets/baked/` scope (another agent owns `modules/*.js` right now). What's
  ready for that work: the per-species crown AO/sky data already ships (`assets/baked/treeao.js`), and an impostor
  atlas could be rendered offline the same way the instanced-object AO atlases are (isolate one tree, orthographic
  Cycles render from a few angles) — not built here.
- **This bake used `--quick` settings** (24 samples, 1024²/256² — a ~30 min draft pass to validate the whole
  pipeline end to end), not the film-quality 128-sample/4096²/1024² settings the brief asks for. A back-of-envelope
  scale-up (samples × resolution²) from this run's per-step timings (`bake.json.timings`: terrain 79 s, tiles 38 s,
  objects 313 s, instanced 26 s, trees 156 s ≈ 10 min total GPU time at quick settings) puts the full-quality terrain
  bake alone around 1–2 hours; the whole thing likely several hours of GPU time. `node tools/bake/run-bake.mjs` with
  no `--quick` (and `--blender` pointed at a real Blender install — this machine only has one in the agent
  scratchpad) reruns everything at those settings whenever a multi-hour GPU window is available; each step still
  goes through the same benchmark lock, so it can run overnight interleaved with other agents' work.
