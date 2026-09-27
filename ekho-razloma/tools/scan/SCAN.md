# Scan pipeline — photogrammetry (Scaniverse) → game-ready assets

One command turns a folder of phone scans into everything a wave-2 module needs:

```
node tools/scan/import.mjs <folder>
```

Shot list for what to scan: [SHOTLIST.md](SHOTLIST.md).

## Pipeline

```
Scaniverse export (GLB/OBJ/USDZ/STL … or SPZ/PLY/splat)
        │
        ▼
tools/scan/import.mjs  ─┬─ mesh (.glb .gltf .obj .usdz .usdc .usd .fbx .stl, mesh .ply)
                         │     → tools/scan/scan_blender.py  (Blender 4.2, headless)
                         │       import → orient/scale → weld+floaters+ground-cut →
                         │       voxel remesh (closed shell) → LOD0/1/2 decimate →
                         │       xatlas UV → Cycles bake (albedo/normal/AO per LOD) →
                         │       delight (remove baked AO + fitted sun/sky gradient) →
                         │       night grade from style.js → GLB (+ extras.scan meta)
                         │       → thumbnails (input vs output, game's night rig)
                         │
                         └─ splat (.spz, gaussian .ply, .splat)
                               → tools/scan/splat.mjs (pure JS, no Blender)
                                 decode → RANSAC ground-plane level → crop to object →
                                 floater/isolated-splat removal → scale/base y=0 →
                                 importance budget (≤ --max) → SH truncate → delight
                                 (shortest-axis normal, fitted light) → night grade →
                                 SPZ v2 (gzip) → base64 JS chunks
        │
        ▼
assets/incoming4/scan/<name>/
  <name>.js            JPG-texture pack   (window.__PACK['<name>'] = base64 GLB)
  <name>_ktx2.js        KTX2 variant       (window.__PACK['<name>_ktx2'] = base64 GLB, mesh only)
  <name>.spz.<i>.js      SPZ chunk(s)       (window.__PACK['<name>#<i>'], splat only)
  <name>.json            full metadata: tris, sizes, bounds, bake/clean/delight numbers,
                          suggested Passport role, usage snippet
  thumb.jpg / thumb_src.jpg / thumb_lod2.jpg
assets/incoming4/scan/index.json   merged summary of every asset processed so far
```

Both paths follow MODULES.md's asset convention exactly: a classic-script pack at
`assets/pack/<name>.js` defining `window.__PACK['<name>']`, loaded with `ctx.loadPacked(name, ctx.ASSET, cb)`
(mesh) or `ScanSplat.load(name, dir, cb)` (splat, `tools/scan/scan-splat.js`). No `.glb`/`.bin` files are ever
served — everything is base64 inside a `.js` file, same as every other asset in the game.

Mesh LODs are read back with `ScanLOD.fromGLTF(gltf, THREE)` (`tools/scan/scan-lod.js`) → a `THREE.LOD` with
the three levels at the distances baked into the pack (`userData.scan.lodDist`), and `ScanLOD.passport(lod,
Passport, opts)` to register the drawn (LOD0) mesh with the suggested Passport role.

## import.mjs options

```
--out DIR        output root (default assets/incoming4/scan)
--name N         asset name (single file only)
--role R         rock|wood|ice|snow|masonry|metal|prop (default: guessed from the file name)
--tris a,b,c     LOD triangle budgets (default 5000,1500,300)
--tex N          texture size (default 1024)
--height M | --scale S     real size (Scaniverse is already metric: usually leave both out)
--up AXIS        y (default) -y x -x z -z, if the scan lies on its side
--yaw DEG        turn around the vertical axis
--cut-ground V   auto (default) | off | metres above the lowest point
--remesh voxel|none        closed shell (default) or decimate as-is (thin parts: crates, tyres)
--delight-ao K / --delight-dir K   how much baked cavity / directional light to remove
--tint K         strength of the night grade from style.js
--no-ktx2 / --ktx2-normal uastc
--jpeg-q N  --force
```

Splat-specific options (`tools/scan/splat.mjs`, forwarded automatically for `.spz`/`.splat`/gaussian `.ply`
inputs): `--up auto|y|...`, `--frame colmap|rub`, `--crop auto|off|R`, `--cut-ground`, `--min-alpha`, `--max`
(splat budget, default 400 000), `--sh 0..3`, `--chunk MB`. Full option docs are in the header comment of each
script.

Both the mesh and splat path **read `style.js` at run time (never write it)** to pick the night-grade tint and
target luminance per role (`rock_basalt`, `bark`, `snow`, `metal_dark`, …), so a scan's colour always matches
the game's own material palette instead of the scan's original lighting.

Tools needed: Blender 4.2 LTS and `basisu` (KTX2 encoder) — `tools/scan/setup.sh` fetches/builds both into the
gitignored `tools/scan/.bin/`, plus `xatlas` for Blender's Python and the Spark worker shim (see Splat / CSP
below). Nothing under `.bin/` or `.work/` is committed.

## Suggested Passport role

`import.mjs` estimates a Passport role from the scan's measured size/volume and file name and stamps it into
the pack's `extras.scan.passportRole` (mesh) / the asset's `.json` (`passport.role`, both paths):

- **passable** — low (< 25 cm) and footprint-wide (snow patches, footprint patches): walk over it, no collider.
- **pushable** — small hollow props whose name matches crate/pallet/tire/barrel/scrap: a light mass estimate
  (`density × volume × 0.2`, from `STYLE`-independent role densities) is included.
- **solid** — everything else: a static or exact-trimesh collider, `cell` tightened for large objects.

This is a suggestion for the wave-2 agent wiring the asset in, not a final decision — `meta.usage` in the
asset's `.json` gives the exact `Passport.register(...)` call to copy.

## Validation: CC0 stand-ins already in `assets/incoming4/scan`

`tools/scan/test/make_standin.py` turns a clean CC0 photogrammetry model into a synthetic "phone scan" — bakes
a sunny-day sun + sky into a single albedo texture (what Scaniverse itself hands back: no separate
normal/AO, daylight baked in) — so `import.mjs`'s delight/relight step has something real to undo. Four such
stand-ins were run end to end:

| Asset | Source | Role | Tris L0/1/2 | Size (m) | Pack (JPG / KTX2) | Passport | Bake |
|---|---|---|---|---|---|---|---|
| `scan_boulder_ground` | boulder_ground.glb (rock, kept its ground patch) | rock | 5000/1500/300 | 1.28×0.96×1.83 | 1.69 / 2.74 MB | solid (trimesh) | 52.5 s |
| `scan_rock_split` | rock_split.obj | rock | 5000/1500/300 | 2.52×1.90×2.50 | 1.27 / 2.03 MB | solid (trimesh) | — |
| `scan_stump` | stump.glb | wood | 5000/1500/300 | 1.41×0.57×1.57 | 1.15 / 1.83 MB | solid | — |
| `scan_cactus` ⚠️ | cactus.obj | prop | 5000/1500/300 | 0.65×0.94×0.66 | 1.68 / 1.75 MB | solid | 65.3 s |

⚠️ **`scan_cactus` is off-theme for an arctic-night game — it's the only CC0 stand-in with strong, isolated
directional highlights suited for exercising the delight fit, and a lone-obj-texture (`objLoneTexture`) test
case. Keep it as a pipeline test asset only; do not ship it.**

All four: delight correlation between shading and surface normal dropped by ~4–10× after the fit (e.g. boulder
0.643 → 0.063, cactus 0.189 → 0.04 — see each `<name>.json`'s `delight.corrShadingBefore/After`), confirming the
baked-in sun direction is actually being removed rather than just darkened uniformly. Ground-cut, voxel-remesh
closed shell, LOD decimation, xatlas UV, and KTX2 re-encode all completed without a fallback path taken.
Thumbnails (`thumb.jpg`, night rig) for all four show a clean, ground-free, evenly toned object — visually
checked, not just by the numbers.

### Splat path (same 4 stand-ins' higher-poly capture, 3 variants)

| Asset | Input | Splats in → out | SPZ | Bytes/splat | Chunks |
|---|---|---|---|---|---|
| `splat_cactus_209k` | cactus_209k.ply (205k) | 204 684 → 196 657 | 2.67 MB | 13.6 B | 1 |
| `splat_cactus_464k` | cactus_464k.ply (452k) | 452 451 → 341 971 (cropped to object) | 4.68 MB | 13.7 B | 2 |
| `splat_cactus_scene` | same file, `--crop off` | 452 451 → 446 094 (scene kept) | 6.13 MB | 13.7 B | 2 |

Ground-plane RANSAC, object crop, isolated-splat removal, delight (fitted light direction, e.g.
`[0, 0.99, -0.02]` — nearly straight down, matching a turntable capture lit from above) and the night grade all
ran cleanly; screenshots below confirm the geometry (a potted cactus) survived cropping and relighting intact.

## Splat renderer: fps / memory / CSP (the *ultra*-preset path)

`tools/scan/splat-test.html` loads a splat pack (`ScanSplat.load`) and renders it with a renderer picked by
`?r=`: **spark** (`@sparkjsdev/spark`, WebGL2) or **three** (three r186's own `GaussianSplat`, via
`WebGPURenderer`, optionally forced to its WebGL2 fallback with `&webgl=1`). `tools/scan/splat-bench.mjs`
drives it in headless Chrome with the real GPU (Metal/ANGLE), serving the game directory under the project's
own emulated claude.ai artifact CSP (identical string to `tools/stand.mjs`), and measured:

| Renderer | Backend | 200k splats | 464k (cropped) | scene (446k) | GPU memory Δ | JS heap |
|---|---|---|---|---|---|---|
| spark | WebGL2 | 60 fps (vsync) · ~6 300 fps uncapped | 60 fps · ~7 300 fps uncapped | 60 fps · ~6 500 fps uncapped | +90–330 MB | 7–9 MB |
| three | WebGPU | 60 fps (vsync) · ~590 fps uncapped | 60 fps · ~350 fps uncapped | 60 fps · ~320 fps uncapped | +150–440 MB | 7–10 MB |
| three (forced WebGL2) | WebGL2 | 60 fps · ~540 fps uncapped | 60 fps · ~6 800 fps uncapped | 60 fps · ~7 100 fps uncapped | +90–500 MB | 8–13 MB |

GPU-synced true frame cost (render + `onSubmittedWorkDone`/`readPixels`, not just how fast rAF can be queued):
**0.1–5 ms/frame** for every renderer × splat-count combination — nowhere near the 16.6 ms budget for 60 fps,
so even the slowest renderer (three/WebGPU on 446k splats, ~3.6–4.8 ms median) has large headroom. All numbers
were collected while the benchmark machine itself was **not idle** (another headless Chrome + background load
running — `bench.json`'s `machine.quiet: false` in every run); the margins above the 60 fps target are wide
enough that this doesn't change the conclusion, but treat the exact uncapped-fps figures as noisy, not exact.

**CSP verdict: splats work under this project's artifact CSP.** Every renderer × splat-count combination was
also run with the CSP header removed (`--csp off`) as a control — **identical** fps and GPU-memory numbers on
and off, and no `securitypolicyviolation` events at all. The one recurring console error (`404 Not Found`,
every run, CSP on *and* off) is unrelated to the CSP — it fires identically with the policy removed, so it's a
missing incidental resource (e.g. a favicon request), not a blocked one. Two things make this pass, and both
already exist in this repo for the same reason (`tools/stand.mjs`, "Rapier physics"):

- **`script-src` lists the three CDNs** (jsdelivr/cdnjs/unpkg) — this is how `import()` of `three`,
  `three/webgpu` and `@sparkjsdev/spark` from a `<script type="importmap">` is allowed to run at all under a
  same-origin-only `default-src 'self'`; it is not a `connect-src` (fetch) exemption, so "no external fetch
  after the page loads" still holds — the splat data itself is always same-origin (the base64 `.js` pack).
- **Spark's own worker is instantiated from a `blob:` URL**, which this CSP's implicit `worker-src` (falling
  back to `script-src`) refuses. `tools/scan/vendor/make-spark-worker.mjs` extracts that inline worker once
  into a same-origin file (`vendor/spark-worker-2.2.0.js`); `ScanSplat.shimWorkers(url)` in `scan-splat.js`
  replaces `window.Worker` so any `blob:`/`data:` worker construction is redirected there instead. Without the
  shim, Spark under this CSP would throw when it tries to start its worker — the shim is not optional for the
  spark renderer.
- **`wasm-unsafe-eval` is already in this CSP** (needed elsewhere for Rapier physics) — neither renderer here
  actually needs WASM (three's WebGPU/WebGL2 splat path and Spark are both pure JS/GLSL/WGSL), so this
  pipeline doesn't depend on that directive, but it's available if a future splat renderer wants it.

Recommendation for the *ultra* preset: **either renderer is safe to ship**; `spark` is the simpler default (one
import, WebGL2 only, no backend branch), `three`'s own `GaussianSplat` avoids the extra dependency and worker
shim entirely when a WebGPU-capable browser is assumed (falls back to WebGL2 automatically via
`forceWebGL`/backend detection) — pick whichever the *ultra* module already leans towards for other objects.
Budget headroom is large enough that the 400k-splat default cap in `splat.mjs` could be raised for a single
hero scene without risking frame time, if art wants more detail.

## Known limitations / follow-ups

- Benchmarks above ran on a busy machine (see caveat); re-run `splat-bench.mjs` on an idle machine before
  trusting the exact fps numbers for a capacity budget, not just the pass/fail margin.
- `scan_cactus` (mesh) and the three `splat_cactus_*` assets are CC0 test stand-ins only — off-theme for the
  arctic setting, kept to prove the pipeline, not for shipping. Real content should follow SHOTLIST.md.
- `scan_blender.py`'s bake device (`bakeDevice: "GPU"` in the metadata) depends on Blender finding a Metal
  Cycles device at run time; on a machine without one it falls back to CPU (slower, same output).
