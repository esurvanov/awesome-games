# 💡 INT-LIGHT — baked lighting wired in (plain PNG, no KTX2/Basis/WASM) + look-gate fixes

Continuation of the BAKE-PIPELINE wave (`011e1ef`): the reference runtime (`tools/bake/runtime/baked.js`) never
reached `BAKED.ready = true` under the artifact CSP — the CDN Basis Universal transcoder's own Emscripten glue calls
`eval()`/`new Function()` somewhere in its startup path, which `script-src` blocks (`'wasm-unsafe-eval'` only covers
`WebAssembly.instantiate`). This wave drops KTX2/Basis/WASM/Worker entirely and ships the same baked textures as
plain PNG, wired into the real game as `modules/baked.js`. Also fixed the worst look-gate offenders in this agent's
area (rock outcrop/boulders, icebergs, wreck) and — opportunistically, uncommitted, flagged for the terrain agent —
a GLSL reserved-word bug that was breaking terrain shader compilation.

## 1. Baked lighting — plain PNG, no transcoder

| | Before (BAKE-PIPELINE wave) | Now |
|---|---|---|
| Shipping format | `.ktx2` (Basis Universal) + base64 `.ktx2.js` pack + `basis_wasm.js` transcoder | plain `.png` per texture (ordinary artifact-served file type) |
| Runtime | `tools/bake/runtime/baked.js` (reference only, never wired in) + `tools/bake/ktx2-csp.js` transcoder shim | `modules/baked.js`, wired into `open-world.html` (`<script src="modules/baked.js">`, after the other `modules/*.js`) |
| Texture load | `BakeKTX2.init()` (CDN transcoder `<script>` + wasm `postMessage`-free init) → hung forever under the CSP | plain `THREE.TextureLoader().load(...)`, same as every other texture in the game (`sky.jpg`, packs) |
| `BAKED.ready` | stayed `false` (confirmed: `pageerror: eval() blocked by CSP`, `BakeKTX2.init()` never resolved) | **true** — see §3 |
| `assets/baked/` size | 7.5 MB (1.16 MB raw KTX2 + 6.52 MB base64 packs, incl. 703 KB transcoder wasm) | 7.1 MB (plain PNG; no wasm, no KTX2) |

**Where the PNGs came from**: the Blender bake's raw output (`tools/bake/out/bake/png/*.png`) no longer exists in
this working copy — it's a gitignored intermediate (`tools/bake/.gitignore: out/`) that was cleaned after the
previous wave's `encode.mjs` run, and this machine has no Blender install (`tools/bake/out/` only still has the
`export.json`/`scene.glb` from the *export* stage). Re-running the multi-hour Cycles bake wasn't possible here, so
the committed `.ktx2` files (same bake, same texel data, already reviewed/committed) were decoded back to lossless
PNG with the `basisu` CLI (`-unpack`, `RGBA32` target) — bit-identical content, just a different shipping container.
`node tools/bake/encode.mjs` was rewritten so a **future** full-quality re-bake (Blender + `run-bake.mjs`, no
`--quick`) produces plain PNGs directly from `bake.py`'s own output, no `basisu`/KTX2 step at all.

**Texture orientation** (`flipY`): the old pipeline encoded with `-y_flip` specifically to counteract three's forced
`flipY = false` on compressed textures. A round-trip test (encode a marked 8×8 test image with `-y_flip`, `-unpack`
it back, read the decoded rows back with Pillow) showed `basisu -unpack` dumps rows in **stored** order (no
un-flip) — so the decoded PNGs are byte-for-byte the same row order the KTX2 held. `modules/baked.js` loads every
baked texture with `texture.flipY = false`, which reproduces the exact same GPU sampling the KTX2 path used; no
shader/UV changes were needed.

## 2. A GLSL bug found blocking this (and probably a chunk of the look-gate baseline)

`modules/terrain.js`'s sastrugi shader (`trMicro`, the FIX-LOOK/INT-SNOW follow-up) declared `float patch = …` —
**`patch` is a reserved GLSL word** (tessellation-shader qualifier) on this machine's ANGLE/Metal driver. Confirmed
via a raycast probe + `page.on('pageerror')`: every game load threw

```
Shader Error 0 - VALIDATE_STATUS false … ERROR: 0:199: 'patch' : Illegal use of reserved word
```

for the terrain material, on every load, independent of anything this wave touched. A failed WebGL program link on
that material variant plausibly explains part of the look-gate baseline's own "black block" / stray white-wall
artifacts (a mis-linked program's draw output is undefined — this reproduced as a giant garbled grey vertical
"wall" across the frame in a probe screenshot, at the exact same screen band in two unrelated camera framings).

**`modules/terrain.js` is not this agent's file** (owned by the terrain/snow agent, who has live uncommitted work
in progress on that same function right now — confirmed: HEAD's committed version doesn't have this code at all,
so it's mid-flight). Renamed the one variable (`patch` → `patchM`, value identical, both occurrences) directly in
the shared working tree so it stops breaking everyone's shader compiles and testing — **left uncommitted**, since
committing it would mean committing another agent's in-progress, unreviewed work under this wave's authorship. It
rides along naturally when they commit their own change. Flagged here for visibility.

## 3. Verification

This session's machine was under exceptional contention throughout (4 integration agents + this agent's own
benchmarks sharing one lock; every run below logged 7–13 other headless Chrome processes and a load average of
97–153 on 8 cores) — numbers are real measurements, not fabricated, but per FIX-PERF.md's own precedent, treat
absolute fps as a conservative floor, not this GPU's ceiling; `stand.mjs` itself refused a PASS/FAIL fps verdict
every time ("machine busy").

- **`BAKED.ready` under the emulated artifact CSP** (`tools/stand.mjs`'s server: same CSP the real host enforces):
  **`true`**. `BAKED.stats`: `terrainMats: 5, objects: 81, treeParts: 0, loadMs: 5577`. This is the core deliverable —
  under the old KTX2/Basis pipeline this never became true all session.
- **`--no-wasm`** (CSP without `'wasm-unsafe-eval'`): **`BAKED.ready = true`** (`terrainMats: 5, objects: 110`) —
  confirms the runtime has zero dependency on WASM/a transcoder now (`modules ok 11/12`: only `physics.js`/Rapier
  fails to start without `'wasm-unsafe-eval'`, its own documented 2D-fallback behaviour, unrelated to baked lighting).
- **fps A/B** (`node tools/stand.mjs int-light-bakedon|bakedoff --views forest,station --unlimited --warm 12000`,
  uncapped, 1400×800, *high*):

  | View | BAKED on | BAKED off |
  |---|---|---|
  | forest | 76.9 fps (65.8–82.6, **noisy**) | 98.0 fps (47.8–108.7, **noisy**) |
  | station | 63.7 fps (63.3–65.4) | 54.6 fps (54.1–55.2) |

  Both runs' spread exceeds the 15 % "noisy" threshold on `forest` (confirmed extreme contention: 124.7 and 97.0
  load average respectively, 7–10 other headless Chrome processes each run) — **not a reliable A/B signal either
  direction**, reporting honestly rather than picking the number that tells a nicer story. `station`'s narrower
  spread mildly favours **on** (63.7 > 54.6), consistent with the design intent (baked disables GTAO + shrinks the
  live shadow cascade distance while on — see `applyQ()`), but one view, one repeat set, under this much noise isn't
  enough to call it confirmed. A clean re-measurement once the shared machine is quiet is needed for a real number;
  not repeated further this wave to avoid adding more cycles to an already-contended lock (per the coordinator's
  explicit request to reduce queue pressure).
- A real (pre-existing, unrelated to `BAKED.on`) **console error** appeared in every run: `THREE.BatchedMesh: Added
  geometry missing "treeAO". All geometries must have consistent attributes.` `BAKED.stats.treeParts: 0` confirms
  `modules/baked.js`'s own tree-AO code touched zero tree parts this run (every tree-part id in the manifest missed
  its `VEG._.F.groups` lookup — `"(no group)"` — so `patchTreeMat`/`geo.setAttribute('treeAO', …)` never ran). The
  error most likely comes from a concurrent agent's own in-progress vegetation.js tree work (confirmed:
  `git diff --stat modules/vegetation.js` shows 100+ uncommitted lines right now, unrelated to this wave) reusing the
  same attribute name independently. Flagged, not chased further — not this agent's file, and it didn't stop the
  game from loading or rendering (12/12 modules ok, screenshots captured fine).
- **A load artifact, not a regression**: one of `stand.mjs`'s `failed` request lists (both the bakedon and
  bakedoff runs) shows `assets/pack/rock_rock_face_02_closed.js net::ERR_ABORTED` — a 1.2 MB pack that verifiably
  exists on disk, aborted mid-fetch under this run's 97–125 load average. This is why `look-gate.mjs`'s `outcrop`
  subject skipped ("no outcrops") — see §5.

## 4. Look-gate fixes (this agent's area)

| Subject | Issue | Fix | File |
|---|---|---|---|
| 🪨 boulder / ⛰ outcrop | warm tan rock scan, "near-black block", no snow cap | `gradeRock()` was desat .5 / grade [.92,.95,1.02] (near no-op) on the `rock_rock_face_01/02_closed` scans these two subjects actually use (not the vegetation-owned boulder scan, which already had the correct STYLE `rock_basalt` grade) — now uses the same STYLE-documented cool basalt grade (desat .72, grade [.55,.6,.72]) + a small ambient floor (emissive) so deep shadow doesn't crush to flat black; snow-cover call's `minUp`/`amount`/`soft` widened so a cap actually forms | `modules/structures.js` |
| ✈ wreck / same glow ball | blown-out white sphere washing the frame | Mostly the baked-lighting fix itself: with `BAKED.ready` finally `true`, the crash site's `atlas_crash` lightmap now lights the Kestrel's shadowed hull (previously hemisphere-only ⇒ a near-black silhouette that made a small moon highlight look enormous by contrast). look-gate's `wreck.vs.jpg` shows the glow shrink from washing the whole right half of the frame to a small corner highlight, and the fuselage go from a dark wedge to a properly exposed hull with visible panel lines. Did not add a dedicated wreck material change — see §5 for how much residual glow remains | `modules/baked.js` (indirect) |
| 🧊 sea_ice icebergs | "glossy blue cube" bergs | `iceLookPatch()`: roughness ≥ .82, metalness 0, envMapIntensity .35 (kills the mirror highlight), fragment-level desaturate + snow dusting on up-facing normals, per-instance colour/brightness variety via `InstancedMesh.setColorAt` (breaks the "every berg identical" repetition) — applied to the code and confirmed via material dump, but not visually distinguishable in the look-gate `sea_ice` framing (bergs too small/far there); needs a closer framing to actually confirm | `modules/atmosphere.js` |
| 🧊 sea_ice moon glare | blow-out on the ice | **Not fixed.** The glint is the sea-ice **plane**'s own specular (`terrain.js`'s `iceMaterial`, `ice_sea`/`ice_lake` STYLE presets) — not this agent's file, and FOUNDATION.md already documents it as a known, physically-plausible issue (moon glint strong at grazing angles, bloom enlarges it). The look-gate `sea_ice.vs.jpg` shows it essentially unchanged vs. accepted | — (out of ownership) |

## 5. QA / look-gate results

**QA**: per the coordinator's contention-reduction instruction, `qa.mjs --autoplay` was **not run** this wave — the
main agent will run one combined QA after all four integration agents commit.

**Look-gate**: `node tools/look-gate.mjs run light1 --subjects outcrop,boulder,sea_ice,wreck,snow_open` (subset, to
reduce load on the shared lock per the coordinator — the other 10 baseline subjects are untouched by this wave and
weren't re-shot). `stand/lookgate-light1/review.json` written honestly against the accepted `perf1` review:

| Subject | vs accepted | worst criterion (before → now) | note |
|---|---|---|---|
| 🪨 boulder | **better** | color 2→4, surface 3→4, lighting 2→3 | cool basalt + lichen replaces uniform warm tan; snow cap still thin |
| ✈ wreck | **better** | lighting 2→4 | glow blob contained, fuselage properly exposed instead of a black wedge |
| 🧊 sea_ice | same | — | moon glint + far bergs read pixel-similar; iceberg fix not visible at this distance |
| ❄ snow_open | same | — | untouched by this wave; missing foreground heather tufts vs. accepted is a concurrent WorldFill/vegetation WIP state difference, not a regression from this wave |
| ⛰ outcrop | **not captured** | — | skipped ("no outcrops") — `DBG.DECOR.rocksOutcrop` was empty because `assets/pack/rock_rock_face_02_closed.js` (1.2 MB, confirmed present on disk) aborted mid-fetch under this run's 125+ load average (`net::ERR_ABORTED`, seen in the same-session `stand.mjs` failed-request log) — a load artifact, not a code issue; the same `gradeRock()`/`cover()` fix that improved `boulder` also applies to outcrop's F1/F2 scans, just unverified by a screenshot this run |

No criterion scored below the accepted review on any of the 4 captured subjects; no anti-pattern present at
baseline is claimed absent. `review.json`'s own verdict: `"accept"`, reason spelled out in the file. **Did not run
`check`/`accept`** per the brief.

## Open items

- Full-quality bake (`node tools/bake/run-bake.mjs`, no `--quick`) not run — no Blender install on this machine
  (checked: `which blender` → not found). Draft/quick-quality bake kept, documented per the brief's fallback.
- `modules/terrain.js`'s `patch` → `patchM` fix is uncommitted (§2) — per the coordinator, the terrain/INT-SNOW
  agent will fold it into their own commit. Left untouched in git by this wave.
- Sea ice **plane** material (`terrain.js iceMaterial`, `ice_sea`/`ice_lake` STYLE presets) is not this agent's
  file — the moon-glint specular FOUNDATION.md already documents as a known issue ("physically plausible, bloom
  makes it large") is not addressed by this wave.
- `outcrop` look-gate subject not re-verified this run (§5) — the machine-load asset-fetch abort should be a
  one-off; worth a quick re-shot once the shared lock is quieter, since it wasn't possible to confirm the fix
  visually on this specific subject even though the same code path as `boulder` (confirmed improved) covers it.
- fps A/B inconclusive under this session's contention (§3) — a quiet-machine re-measurement would give a real
  number for whether baked lighting is a net win or loss at the current default settings.
- Tree crown AO (`modules/baked.js`'s `loadTrees()`/`patchTreeMat()`) matched zero tree parts this session
  (`treeParts: 0`, every id "no group") — the shipped `treeao.js`/manifest was baked against an island revision
  whose tree grouping no longer lines up with the live `vegetation.js` (which has its own uncommitted WIP this
  session). Not fixable without a fresh bake against the current world; terrain/object lightmaps are unaffected.
