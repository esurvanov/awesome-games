# 🦶 GROUNDBLEND — one rule for how every object meets the snow

Code: `modules/groundblend.js` (order 60, after baked.js) · vegetation base alignment in `modules/vegetation.js` · NASA hab
material in `modules/structures.js`. A/B: `?off=gb` or `GroundBlend.setOn(false)`.

## ⛓ Before → now

| | Before | Now |
|---|---|---|
| Rule | each object its own rule or none | **one** shader chunk, every lit static material, patched automatically (0.5 s scan) |
| Snow surface in shader | 0.88 m grid, nearest texel → stair-stepped skirt | 0.375 m field of the **drawn** surface (`snowSurfaceAt`), bilinear; terrain `tDD` beyond ±48 m |
| Skirt | partial blend over the band → pale haze | height-blend, noisy crisp edge, height ∝ loose depth, none on bare ground |
| Top snow | only where a module called `snowCover` | `snowCover` on every rock/structure/prop · cap threshold ≤ class value · × sky visibility (overhangs) |
| Contact AO | none since GTAO removal | objects: band at the snow line · ground: world AO ring (vertex stage) · bushes: soft moon shadow |
| Tufts / heather | CPU physics height + depth (render surface differs −8…+25 cm) | GPU: base per vertex on the drawn surface, sunk 3.5–15 cm, patchy snow base |
| NASA hab | glTF default metalness 1 → dark blob | metalness .05, rough .62 + world micro-variation, grime band, snow cap |
| Textures | anisotropy 1 | `Q.gbAniso` (low 4 · med/high 8 · ultra 16) on patched materials |

## 🗺 Data (player-centred, 96 m, 256² = 0.375 m)

```
CPU  snowSurfaceAt + snowDepthAt ──► RG32F toroidal (rolling 1 row/frame, new strips on 6 m moves)
GPU  top-down ortho render, layers 12 solids · 13 shrubs · 14 tufts ──► highest y per texel
     combine ──► tGb  R surface · G ground AO (16 taps ≤ 2 m + 8 taps ≤ 0.6 m) · B top y · A depth
     march to MOON_DIR through soft occluders ──► tGbSh (terrain direct light)
```
Hook: `ctx.snowField = { sample(x, z) → [surfaceY, depth] }` replaces the CPU sampler (`surfaceSampler()`, one line).

## 🧩 Classes (`CLS`)

| Class | Skirt base / per m depth | AO k / reach | Grime | Cap ≤ |
|---|---|---|---|---|
| 🪨 rock | 7 cm / 0.9 | .32 / .45 m | – | .50 |
| 🏠 struct | 9 cm / 1.0 | .30 / .70 m | ✔ | .62 |
| 📦 prop | 3.5 cm / 0.45 | .30 / .40 m | – | .62 |
| 🌲 bark | 5 cm / 1.1 | .25 / .40 m | – | – |
| 🧊 ice | 4 cm / 0.6 | .20 / .50 m | – | – |

Skipped: skinned, player/animals/enemies/snowmobile, veg cards, glow/fx/glass/cords, sea/lake/terrain, meshes > 400 m.

## 🔗 Chaining

- Wrapper injects only while it is the material's **outermost** `onBeforeCompile`; the scan re-wraps if another module chains later → sees snowCover / baked / SAFE_END text, never applies twice (baked.js clones handled).
- Terrain: **vertex stage only** — TR_DETAIL + baked already use all 16 fragment texture units (a fragment sampler failed to link, measured). Shader errors with my markers are caught (`GroundBlend.stats.errors`); terrain patch auto-drops on error.
- `GroundBlend.verify()` → patched / compiled / failed per material.

## ✅ Verification (M1 Pro)

| Check | Result |
|---|---|
| Shader errors from this module | **0** · verify: 166 patched, 154 compiled, 12 not yet drawn, **0 failed** · terrain 5/5 ok |
| JS errors | 0 |
| Cost, interleaved on/off in one page (`tools/qa/gb-ab.mjs`) | high 1400×800: Δ −3.2…+0.8 ms · low: −4.7…+0.2 · Retina 1512×860@2: −1.2…+1.3 · all within noise (machine load 10–120, other agents' Chromes) |
| Periodic | top map render ≈ 1.3 ms CPU every 3 s / 6 m move · CPU field ≈ 0.1 ms/frame |

Files: `stand/gb-ab-{high,low}-1400x800@1.json`, `stand/gb-ab-high-1512x860@2.json`, before `stand/gb-before-{high,low,retina}/`.

## 👁 Look-gate

- Before (HEAD, same subjects): `stand/lookgate-ground0/` · after: `stand/lookgate-ground1/` + `review.json`
- New subject 🦶 `contact_close` (third-person: rock_close · tuft_close · heather_close · hab_close) in `tools/look/`.

| Subject | vs ground0 | Note |
|---|---|---|
| 🪨 rock_close | ⬆ | cap on top faces, snow pillow skirt, no pale haze |
| 🪨 boulder | ⬆ | pale skirt gone, contact crease; no cap on sloped top |
| 🏠 hab_close | ⬆⬆ | lit, grime base, snow cap; texture still soft |
| 🌾 tufts | ⬆ | no floating; slightly sparser look |
| 🌿 heather | ≈⬆ | snowy base, faint shadow; still reads flat |
| 🏠 station_night | = | radome dark side identical in ground0 (not this wave) |

## ⚠ Open

- 🧱 **Terrain WIP breaks rendering right now**: uncommitted `modules/terrain.js` adds samplers → TR_DETAIL 17 > 16 fragment units with baked.js → broken ground. My runs used a HEAD worktree for that reason.
- 🪨 Boulder caps: shader cap needs faces ≥ ~55° up; the boulder scan's top is sloped → needs a drift/pillow mesh.
- 🏠 Hab asset: 1024² atlas with painted-in shading, NASA logos/flags. Real fix = replacement asset (proposal, not downloaded: a CC0 modular habitat from Poly Haven / ambientCG-textured model, or repaint the atlas at 2048² without logos).
- 🌿 Heather: bushes cast no moon shadow in the shadow maps (vegetation keeps them out for cost); only the soft field shadow.
