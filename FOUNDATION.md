# FOUNDATION — engine, image pipeline, colliders, test bench

State of `open-world.html` + `physics.js` + `worldfill.js` after the foundation pass (2026-09-25).
Other agents: build on the APIs in §3–§5; check your work with the bench in §6.

| Area | Before | Now |
|---|---|---|
| Engine | three r128 (UMD + `examples/js`) | **three 0.186.1** ES modules via importmap, exposed as global `THREE` |
| Color | linear math written straight to the screen, per-object fixes | sRGB in/out, ACES tone mapping, physical light units, no per-object fixes |
| Shadows | one 1536² map, ±45 m | moon `SunLight`, 2 cascades (sharp to ~30 m, soft to 250 m on *high*) |
| Contact shading | none | GTAO (depth-only, near field 70 m) |
| Colliders | hand-typed vertical 14 m cylinders | **Passport**: every collider built from the drawn triangles |
| Collision tests (bench) | 0/7 | **8/8** |
| fps, 1400×800, *high*, vsync | 59.9 (all views) | 59.9 (all views) |

---

## 1. Engine + bootstrap

`open-world.html` head:

```
<script type="importmap">  three → cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js
                           three/addons/ → …/three@0.186.1/examples/jsm/
<script type="module">     bootstrap: imports three + addons, defines CascadedSunShadow, sets window.THREE
<script src=physics.js>    classic, starts loading Rapier at once (does not need THREE)
<script src=worldfill.js>  classic, reads THREE from its build(ctx)
<script type="module">     the game (same IIFE as before; runs after the bootstrap, document order)
```

`window.THREE` = the three namespace **plus** `GLTFLoader, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass, GTAOPass, Pass, FullScreenQuad, CopyShader, SunLight, SunLightShadow, CascadedSunShadow, SkeletonUtils (namespace: SkeletonUtils.clone), BufferGeometryUtils`.
Need another addon? Import it in the bootstrap and add it to that `Object.assign` — every URL must stay on `cdn.jsdelivr.net/npm/` (artifact CSP).

Migration notes (what changed for code that touches three):

| r128 | r186 |
|---|---|
| `renderer.outputEncoding`, `texture.encoding` | `renderer.outputColorSpace`, `texture.colorSpace` |
| `WebGLMultisampleRenderTarget` | `new WebGLRenderTarget(w, h, { samples })` |
| legacy light units (×π inside) | physical: directional/hemi ≈ old×π, point lights in **candela** with 1/d² falloff |
| `THREE.SkeletonUtils.clone` (global) | same call, now the imported namespace |
| `attribute.updateRange` | `clearUpdateRanges()` + `addUpdateRange(offset, count)` |
| fog varying `fogDepth` | `vFogDepth` |
| `Color(r,g,b)` = display values | `Color(r,g,b)` = **linear**; use `setRGB(r,g,b, THREE.SRGBColorSpace)` or `setHex` for authored colors |

GLB packs still load as before (`loadPacked` → `GLTFLoader.parse`, `createImageBitmap` hidden during parse because `fetch(blob:)` is blocked in the artifact).

## 2. Color and light pipeline

```
scene (linear, HalfFloat, MSAA only here) → GTAO → bloom → OutputPass (ACES, exposure 0.8, sRGB) → grade (vignette, grain, hurt, scan)
```

Rules — follow them and a new model looks right without tuning:
- **glTF**: load and add. `prepModel(root, height)` only sets shadows/scale. Never touch `material.color`, never force texture color spaces.
- **Textures you create**: albedo/colour → `t.colorSpace = THREE.SRGBColorSpace`; normal/roughness/masks → default (`NoColorSpace`).
- **Hex colors** (`color: 0x…`) are sRGB and decoded automatically. **Numeric colors authored by eye** (vertex colors, `[r,g,b]` arrays) → decode once with `lin()` / `linArr()` (open-world) or `lin`/`linArr` inside worldfill.
- **Custom `ShaderMaterial`** outputs linear scene radiance (it is tone-mapped later). Display-authored constants → wrap in `pow(c, vec3(2.2))` (`wfLin`/`toLin` helpers exist).
- **Emitters** (glow sprites, beams, screens) are HDR: `GLOW_GAIN = 2.4`, bloom threshold 1.15 → only things brighter than white bloom.

Lights (`open-world.html`, RENDERER block):

| Light | Value | Role |
|---|---|---|
| `moon` `SunLight` | `0xb4c6ff`, 2.8, dir `MOON_DIR` (matches the moon in `sky.jpg`) | key light, cascaded shadows |
| `hemi` | sky `0x7d9de0` / ground `0x2c3c70`, 1.2 | sky + snow bounce |
| `aurLight` | `0x5cf5c0`, 0.7 × aurora intensity | aurora tint |
| point lights | station 40 cd · spire 140 · cell 30 · heart 600 · fire 24 (flicker) | `candela()` helper |
| environment | PMREM of the **same sky dome** that is drawn as background (`updateEnv`, re-baked when aurora/storm change, ≤ every 1.5 s) | reflections, ambient specular |

Sky: `assets/sky.jpg` decoded as sRGB, scaled to night (`ph² × (0.07, 0.085, 0.16)`), moon disc HDR, stars, aurora — one shader for background and environment.

Shadows: `moon.shadow = new THREE.CascadedSunShadow()` = r186 `SunLightShadow` (2 cascades, texel-snapped, fade band) with a tunable `splitLambda` (0 = uniform, 1 = log). *high*: 250 m, 2048² per cascade, λ 0.85 → first cascade ≈ 30 m. Bias −0.0004, normalBias 0.035, PCF radius 2.2.
Trees cast shadows only within `QUALITY.treeShadow` (the far cascade would otherwise redraw ~2 M tree triangles).

AO: `GTAOPass` in depth-only mode (reads `post.sceneRT.depthTexture`, no extra geometry pass), half resolution, radius 1.4 m, clipped to a 70 m box around the camera (no far-depth banding).

## 3. QUALITY presets — `setQuality(name)`

```js
QUALITY = { low, med, high, ultra }   // plain objects, editable
Q                                     // the active preset (+ Q.name)
setQuality('med')                     // → 'med'
```

| Field | low | med | high | ultra | Effect |
|---|---|---|---|---|---|
| `pixelRatio` | 1 | 1.25 | 1.5 | 2 | capped by devicePixelRatio |
| `msaa` | 0 | 4 | 4 | 4 | scene target samples |
| `shadowDist` | 90 | 170 | 250 | 320 | moon shadow range, m |
| `shadowMap` | 1024 | 1536 | 2048 | 3072 | per cascade (atlas 2×1) |
| `cascades` | 2 | 2 | 2 | 2 | informational: fixed by the r186 shader chunk |
| `split` | 0.75 | 0.8 | 0.85 | 0.85 | cascade split λ |
| `ao` / `aoScale` | off | on / 0.5 | on / 0.5 | on / 1 | GTAO on/off, resolution |
| `bloomScale` | 0.35 | 0.5 | 0.5 | 1 | bloom resolution |
| `grass` | 0.45 | 0.75 | 1 | 1.3 | `WorldFill.knobs.density` (new clutter cells) — placeholder knob |
| `treeNear` | 110 | 150 | 175 | 230 | real tree models radius (cones beyond) |
| `treeShadow` | 45 | 70 | 90 | 140 | trees casting shadows |

Switching touches only sizes, distances and pass toggles — **no shader defines**, so no material recompiles. Measured switch spike ≤ 30 ms (MSAA reallocation). Default: *high* (desktop), *low* (coarse pointer). A quality director may call it every few seconds.

## 4. Passport — colliders from the drawn geometry

The invisible-air bug is impossible by construction: nothing creates a collider except `Passport`, and `Passport` only builds from triangles that are rendered.

```js
Passport.register(src, role, opts?)                    // → entry, or array of entries (instanced)
Passport.registerInstances(geometryOrRoot, matrices, role, opts?)   // one model, many placements
Passport.remove(entry)                                 // e.g. the Kestrel when it flies away
```

`src` forms: any `Object3D` (Mesh / Group / loaded glTF root, world transform at call time) · `InstancedMesh` (one entry **per instance**) · `{ geometry, matrix }` · `{ positions: Float32Array, indices? }` (world-space triangles) · `{ point: [x,y,z] }` (trunk with explicit `radius`/`height`).

| Role | Collider (Rapier) | 2D fallback | Use for |
|---|---|---|---|
| `solid` | exact trimesh (`opts.shape: 'hull'` → convex hull) | footprint circles | rocks, wreck, buildings, ruins, props that don't move |
| `trunk` | vertical cylinder fitted to the base ring of the trunk part (`opts.part: /bark/i`); group `TRUNK` | 1 circle | trees, poles, lamp posts, NPC bodies |
| `passable` | none; position recorded | — | grass, shrubs, snow drifts |
| `pushable` | `Phys.spawnDebris(mesh, { shape: 'convex', prop: true, mass })` | circles until physics starts | barrels, crates |
| `trigger` | none; sphere recorded | — | volumes |

`opts`: `name` · `shape` (`mesh`\|`hull`) · `part` (RegExp on material/mesh name) · `mass` · `radius`, `height`, `topFrac` (trunk) · `cell` (vertex-cluster simplification, m) · `friction` · `includeHidden`.
Excluded automatically: sprites, transparent meshes with `depthWrite: false`, invisible meshes, and any mesh with `userData.noCollide = true`.

Queries and tools:
- `Passport.passablesNear(x, z, r)` → `[{x, z, r, h, kind?}]` (grass/shrub cells from WorldFill come through `Passport.providers`) — for a bending system.
- `Passport.triggersAt(x, y, z)` · `Passport.counts()` · `Passport.list` / `byRole` · `Passport.stats` (build ms, tris).
- **K** in game: wire overlay of every collider within 160 m, colored by role, counts in a corner label (Rapier colliders or 2D circles).

Examples:

```js
// static prop from a glb pack
loadPacked('struct_hab_module', ASSET, (g) => { const root = prepModel(g.scene, 0); root.position.set(x, groundH(x, z), z); scene.add(root);
  Passport.register(root, 'solid', { name: 'hab' }); });
// a forest: fit the trunk once, place by matrices
Passport.registerInstances(treeRoot, matrices, 'trunk', { part: /bark/i, name: 'spruce' });
// grass instances: recorded, walk-through
Passport.register(grassInstancedMesh, 'passable');
// kickable
Passport.register(barrelMesh, 'pushable', { mass: 22 });   // mesh must be a direct child of the scene
```

Register **after** the object has its final transform. Static colliders don't follow moving objects: `remove` + `register` again if something is moved for good.
WorldFill registers through `ctx.register`: every structure is wrapped in `scope(role, name, fn)`; wires, guy lines and snow drifts run in `passive()` and stay passable.

Physics side (`physics.js`, see PHYSICS.md): `addStaticTrimesh`, `addStaticConvex`, `sphereCast`, group `TRUNK` (blocks bodies, ignored by the camera). The character un-sticks itself when placed inside a solid (teleport/respawn).

Movement and camera:
- Pilot can stand on rocks, the wreck's wing, crates; slopes up to 45° are walkable.
- **Ledge climb**: jump into a ledge 0.8–1.6 m high (or press jump in front of it) → `ClimbUp_1m` clip, body lerped onto the top (`ledgeAhead`, `startClimb`, `updateClimb`).
- Camera boom: sphere-cast against terrain + `solid` only; pulls in instantly, eases out; below 1 m the pilot model hides instead of the camera entering it.

## 5. Test hooks — `window.DBG` (only with `#dbg` in the URL)

`player, G, cam, camera, scene, renderer, THREE, WORLD, DECOR, FOREST, POI, getH, groundH, PH, AV, sk, fox, STAGS, WX, Dialog, keys, pressed, Passport, QUALITY, Q, setQuality, post, moon, hemi, aurLight, skyU, CLIMB, ledgeAhead, toggleColliderView, terrainMesh`
plus `newGame()`, `teleport(x, z, yaw?, y?)` (no `y` → lands on top of whatever is there), `camOv = { pos, look }` (free camera), `targets.boulders()`.

## 6. Test bench — `tools/stand.mjs`

```
node tools/stand.mjs <label> [--views a,b] [--quality high] [--no-collide | --only-collide] [--tests kestrel_n,boulder,...]
                             [--unlimited] [--no-wasm] [--size 1400x800] [--page other.html] [--eval "<js>"] [--cold] [--headful]
node tools/stand.mjs compare <labelA> <labelB>        → stand/compare.html
```

- Serves the game dir with the artifact CSP and only artifact-served file types; headless Chrome with Metal GPU; opens `open-world.html#dbg`, starts a new game.
- Views (default 8): `crash_close crash_wide station forest boulders rift_rim sea_horizon player_rock`. Extra: `crash_colliders wf_camp wf_ruins wf_ship climb_crate`.
- Per view: PNG + fps (median over 2 s), frame time p95, draw calls and triangles per frame → `stand/<label>/result.json` (+ JS errors, failed requests, loader modules, GPU string, other headless Chrome count).
- Collision tests: walk into the Kestrel from 4 sides, a boulder, a spruce trunk — closest gap between the capsule and the **drawn** surface must be within ±0.3 m (double-sided rays, so walking inside a mesh shows as negative); climb a 1.2 m crate; jump onto a 1.45 m boulder and end grounded on top. `stopped by` names the Passport entry that physically blocked the pilot.
- `--unlimited` turns vsync off (headroom). `--no-wasm` removes `wasm-unsafe-eval` → exercises the 2D fallback.
- `stand/before-src/` = the original files + the DBG hooks, for `--page stand/before-src/open-world.html`.
- Uses a persistent profile `tools/.chrome-profile` (warm CDN cache); other agents' headless browsers lower vsync fps — the log prints a note when they are running.

Current results (`stand/before` → `stand/after`, M1 Pro, 1400×800, *high*):

| View | fps vsync | fps no vsync | draw calls | triangles |
|---|---|---|---|---|
| crash_close | 59.9 → 59.9 | 117.6 → 70.4 | 401 → 625 | 3.90M → 4.01M |
| crash_wide | 59.9 → 59.9 | 119 → 67.1 | 322 → 495 | 4.50M → 4.59M |
| station | 59.9 → 59.9 | 114.9 → 69.4 | 369 → 566 | 6.65M → 5.65M |
| forest | 59.9 → 59.9 | 71.9 → 60.2 | 332 → 511 | 6.02M → 5.48M |
| boulders | 59.9 → 59.9 | 114.9 → 92.6 | 286 → 508 | 4.17M → 3.71M |
| rift_rim | 59.9 → 59.9 | 107.5 → 79.4 | 287 → 513 | 4.62M → 4.61M |
| sea_horizon | 59.9 → 59.9 | 151.5 → 128.2 | 179 → 288 | 2.24M → 2.35M |
| player_rock | 59.9 → 59.9 | 98 → 76.9 | 243 → 421 | 5.23M → 5.35M |

| Collision | before | after |
|---|---|---|
| Kestrel nose / flank / tail / flank | +2.12 m · walked past · +4.47 m · walked past | +0.015 · +0.022 · +0.004 · +0.021 m |
| boulder | −1.55 m (inside) | +0.041 m |
| spruce trunk | +0.49 m (air) | +0.09 m |
| jump onto 1.45 m boulder | fails (y 17.76 / top 18.86) | on top (y 18.99) |
| climb 1.2 m crate | — | ok |

Zero JS errors, 12/12 loader modules, load ≈ 2.5 s warm.

## 6b. Texture-unit budget (TEXUNITS.md) — read before adding a sampler

three.js takes **every** sampler of a program (vertex + fragment) from ONE pool of `MAX_TEXTURE_IMAGE_UNITS` = **16**
(M1 / ANGLE-Metal; also the WebGL2 minimum). Over 16 there is no link error — only `Trying to use N texture units`,
and that material draws wrong. The sum is what counts: your patch + every other module's patch on the same material.

| Family (max program, all presets) | Units now | Headroom | Who samples what |
|---|---|---|---|
| 🏔 terrain contact patch | **15** | 1 | groundblend tGb·tGbSh (v) · terrain tBase·tDD·tDef·tNS·tNR (v) · baked tBakeT·tBakeTiles · terrain tTrD·tTrN (arrays) ·tNz · three envMap·dfgLUT·sunShadowMap |
| 🏔 terrain detail rings | 14 | 2 | same minus tNS, plus tNR in fragment |
| 🏔 terrain far mesh | 10 | 6 | tGb·tGbSh (v) · tBakeT·tBakeTiles · tTrD·tTrN·tNz · three 3 |
| 🌲 trees near (bark) | 12 | 4 | batching 2 (v) · tScDD·tGb · tBakeT·tBakeTiles · map·aoMap·normalMap · three 3 |
| 🌲 trees near (needles/leaves) | 8 | 8 | batching 2 (v) · tBakeT·tBakeTiles · map · three 3 |
| 🌌 impostors | 6 | 10 | tImpA·tImpN·tImpD · three 3 |
| 🌾 tufts / shrubs / decals | 6 | 10 | tGb·tGbFar (v) · map · three 3 |
| 🪨 rocks / boulders / outcrops | 13 | 3 | tGb · tVLichen·tVSnow · tScD·tScN·tScDD · map·normal·rough·metal · three 3 |
| 🧱 worldfill stone | **14** | 2 | tGb · tScD·tScN·tScDD · tSnow·tSnowN·tSnowR·tRock·tRockN·tRockR · lightMap · three 3 |
| 🏠 structures (station, Kestrel; NASA hab = 9) | 12 | 4 | tGb · tScD·tScN·tScDD · map·lightMap·normal·rough·metal · three 3 |
| 🧑‍🚀 pilot | 8 | 8 | boneTexture (v) · map·aoMap·rough·metal · three 3 |

Rules: same texture sampled by two patches → share ONE uniform · several greyscale masks → one RGBA · same-size
detail maps → one `sampler2DArray` (see terrain `texArray`) · low-frequency lookups → vertex stage (still counts,
but frees fragment ALU) · a patch that is invisible on a material → skip it there.
Check: `node tools/qa/texunits.mjs --presets all` (exit 1 = FAIL) · in game: `[TEXBUDGET] material "…"` warning.

## 7. Known issues

- Frame cost rose ≈ 55 % (uncapped ~115 → ~75 fps median): AO, 2 shadow cascades, MSAA scene target. vsync fps holds 59.9; weaker GPUs → `setQuality('med'|'low')`.
- `worldfill-demo.html` is still r128 and no longer runs with the new `worldfill.js` (needs the importmap bootstrap and `ctx.register`). `physics-demo.html` still works.
- 2D fallback (no WASM) is approximate: 0.4–1 m of air at concave outlines (Kestrel planform), exact everywhere with Rapier.
- r186 `SunLight` has exactly 2 cascades; `QUALITY.cascades` cannot change that.
- `GTAOPass` depth-only mode needs its internal normal target to exist; it is kept at 1×1.
- Low rounded boulders can be walked onto (surface ≤ 45°) — correct for the shape, but it means "walk into a boulder" does not always stop the pilot.
- Moon glint on the glossy sea ice is strong at grazing angles (physically plausible, bloom makes it large).
- Footprint circles (2D grid for enemies/fox/stags and the fallback) are computed in idle time after load (~0.5 s total, 4 ms per frame).
